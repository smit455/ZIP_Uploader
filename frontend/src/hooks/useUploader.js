import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  finalizeUpload,
  getUploadStatus,
  handshake,
  uploadChunk,
} from '../services/api';
import {
  CHUNK_SIZE,
  MAX_CONCURRENCY,
  MAX_RETRIES,
  buildInitialChunkState,
  getBackoff,
  getChunkSize,
  getPendingChunks,
  isRetryable,
  sleep,
} from '../utils/upload';

const INITIAL_STATUS = 'IDLE';

function buildCompletedLoaded(totalChunks, fileSize) {
  return Object.fromEntries(
    Array.from({ length: totalChunks }, (_, index) => [index, getChunkSize(fileSize, index)]),
  );
}

export function useUploader({ onUploadChanged } = {}) {
  const [file, setFile] = useState(null);
  const [uploadId, setUploadId] = useState(null);
  const [statuses, setStatuses] = useState({});
  const [loadedByChunk, setLoadedByChunk] = useState({});
  const [totalChunks, setTotalChunks] = useState(0);
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [error, setError] = useState('');
  const [speed, setSpeed] = useState(0);
  const [startedAt, setStartedAt] = useState(null);

  const pausedRef = useRef(false);
  const workersRunning = useRef(false);
  const activeXhrs = useRef(new Set());
  const speedSamples = useRef([]);
  const runIdRef = useRef(0);

  const uploadedBytes = useMemo(
    () => Object.values(loadedByChunk).reduce((sum, value) => sum + value, 0),
    [loadedByChunk],
  );

  const progress = file ? Math.min(100, (uploadedBytes / file.size) * 100) : 0;
  const eta = speed > 0 && file
    ? Math.max(0, (file.size - uploadedBytes) / speed)
    : Infinity;

  useEffect(() => {
    if (!startedAt || ['COMPLETED', 'FAILED', 'PAUSED', 'IDLE', 'READY'].includes(status)) return undefined;

    const timer = setInterval(() => {
      const now = Date.now();
      speedSamples.current.push({ time: now, bytes: uploadedBytes });
      speedSamples.current = speedSamples.current.filter((sample) => sample.time >= now - 10_000);

      if (speedSamples.current.length >= 2) {
        const first = speedSamples.current[0];
        const last = speedSamples.current[speedSamples.current.length - 1];
        const seconds = (last.time - first.time) / 1000;
        if (seconds > 0) {
          setSpeed(Math.max(0, (last.bytes - first.bytes) / seconds));
        }
      }
    }, 500);

    return () => clearInterval(timer);
  }, [startedAt, status, uploadedBytes]);

  const setChunkStatus = useCallback((index, value) => {
    setStatuses((current) => ({ ...current, [index]: value }));
  }, []);

  const setChunkLoaded = useCallback((index, loaded) => {
    setLoadedByChunk((current) => ({ ...current, [index]: loaded }));
  }, []);

  const abortActiveRequests = useCallback(() => {
    for (const xhr of activeXhrs.current) xhr.abort();
    activeXhrs.current.clear();
  }, []);

  const waitForFinalization = useCallback(async (currentUploadId, runId) => {
    for (;;) {
      if (runId !== runIdRef.current) throw new Error('Upload operation superseded');

      const info = await getUploadStatus(currentUploadId);
      if (info.status === 'COMPLETED') return info;
      if (info.status === 'FAILED') {
        throw new Error('Finalization failed. The upload can be resumed or retried.');
      }

      await sleep(1000);
    }
  }, []);

  const uploadOneChunk = useCallback(async (currentUploadId, selectedFile, index, runId) => {
    setChunkStatus(index, 'UPLOADING');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (pausedRef.current || !workersRunning.current || runId !== runIdRef.current) {
        throw new Error('Paused');
      }

      try {
        await uploadChunk(
          currentUploadId,
          selectedFile,
          index,
          (loaded) => setChunkLoaded(index, loaded),
          (xhr) => activeXhrs.current.add(xhr),
        );

        setChunkLoaded(index, getChunkSize(selectedFile.size, index));
        setChunkStatus(index, 'SUCCESS');
        return;
      } catch (err) {
        for (const xhr of activeXhrs.current) {
          if (xhr.readyState === XMLHttpRequest.DONE || xhr.readyState === XMLHttpRequest.UNSENT) {
            activeXhrs.current.delete(xhr);
          }
        }

        if (err.message === 'Paused' || pausedRef.current || runId !== runIdRef.current) {
          throw new Error('Paused');
        }

        if (!isRetryable(err) || attempt === MAX_RETRIES) {
          setChunkStatus(index, 'ERROR');
          throw err;
        }

        setChunkStatus(index, 'ERROR');
        await sleep(getBackoff(attempt));
        setChunkStatus(index, 'UPLOADING');
      }
    }
  }, [setChunkLoaded, setChunkStatus]);

  const selectFile = useCallback((selectedFile) => {
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
      setError('Please select a ZIP file.');
      return;
    }

    runIdRef.current += 1;
    pausedRef.current = false;
    workersRunning.current = false;
    abortActiveRequests();

    setError('');
    setFile(selectedFile);
    setUploadId(null);
    setTotalChunks(Math.ceil(selectedFile.size / CHUNK_SIZE));
    setStatuses({});
    setLoadedByChunk({});
    setSpeed(0);
    setStartedAt(null);
    setStatus('READY');
  }, [abortActiveRequests]);

  const startUpload = useCallback(async () => {
    if (!file) return;

    const selectedFile = file;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;

    pausedRef.current = false;
    workersRunning.current = false;
    abortActiveRequests();
    setError('');
    setStatus('HANDSHAKING');

    try {
      const info = await handshake(selectedFile);
      const currentUploadId = Number(info.uploadId);
      const { statuses: nextStatuses, loadedByChunk: nextLoaded } = buildInitialChunkState(
        info.totalChunks,
        selectedFile.size,
        info.uploadedChunks || [],
      );

      setUploadId(currentUploadId);
      setTotalChunks(info.totalChunks);
      setStatuses(nextStatuses);
      setLoadedByChunk(nextLoaded);

      localStorage.setItem('activeUpload', JSON.stringify({
        uploadId: currentUploadId,
        fileKey: `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`,
      }));

      if (info.status === 'COMPLETED') {
        setStatus('COMPLETED');
        onUploadChanged?.();
        return;
      }

      if (info.status === 'PROCESSING') {
        setStatus('FINALIZING');
        await waitForFinalization(currentUploadId, runId);
        setLoadedByChunk(buildCompletedLoaded(info.totalChunks, selectedFile.size));
        setStatus('COMPLETED');
        localStorage.removeItem('activeUpload');
        onUploadChanged?.();
        return;
      }

      const pending = getPendingChunks(info.totalChunks, info.uploadedChunks || []);
      const initialUploadedBytes = (info.uploadedChunks || []).reduce(
        (sum, index) => sum + getChunkSize(selectedFile.size, Number(index)),
        0,
      );

      speedSamples.current = [{ time: Date.now(), bytes: initialUploadedBytes }];
      setSpeed(0);
      setStartedAt(Date.now());
      setStatus('UPLOADING');
      workersRunning.current = true;

      const queue = [...pending];
      const worker = async () => {
        while (workersRunning.current && !pausedRef.current && runId === runIdRef.current) {
          const index = queue.shift();
          if (index === undefined) return;
          await uploadOneChunk(currentUploadId, selectedFile, index, runId);
        }
      };

      const workerCount = Math.min(MAX_CONCURRENCY, queue.length);
      try {
        await Promise.all(Array.from({ length: workerCount }, worker));
      } catch (err) {
        if (err.message === 'Paused') return;
        workersRunning.current = false;
        setStatus('FAILED');
        setError(err.message || 'Chunk upload failed');
        return;
      }

      if (!workersRunning.current || pausedRef.current || runId !== runIdRef.current) return;

      setStatus('FINALIZING');
      const finalResponse = await finalizeUpload(currentUploadId);

      if (finalResponse.status === 'COMPLETED') {
        setLoadedByChunk(buildCompletedLoaded(info.totalChunks, selectedFile.size));
        setStatus('COMPLETED');
        localStorage.removeItem('activeUpload');
        onUploadChanged?.();
        return;
      }

      await waitForFinalization(currentUploadId, runId);
      setLoadedByChunk(buildCompletedLoaded(info.totalChunks, selectedFile.size));
      setStatus('COMPLETED');
      localStorage.removeItem('activeUpload');
      onUploadChanged?.();
    } catch (err) {
      if (err.message === 'Paused') return;
      setError(err.message || 'Upload failed');
      setStatus('FAILED');
    } finally {
      workersRunning.current = false;
      activeXhrs.current.clear();
    }
  }, [abortActiveRequests, file, onUploadChanged, uploadOneChunk, waitForFinalization]);

  const pauseUpload = useCallback(() => {
    pausedRef.current = true;
    workersRunning.current = false;
    abortActiveRequests();
    setStatus('PAUSED');
  }, [abortActiveRequests]);

  const refreshStatus = useCallback(async () => {
    if (!uploadId || !file) return;

    try {
      setError('');
      const info = await getUploadStatus(uploadId);
      const state = buildInitialChunkState(info.totalChunks, info.totalSize, info.uploadedChunks || []);
      setStatuses(state.statuses);
      setLoadedByChunk(state.loadedByChunk);
      setTotalChunks(info.totalChunks);

      if (info.status === 'PROCESSING') {
        setStatus('FINALIZING');
        await waitForFinalization(uploadId, runIdRef.current);
        setLoadedByChunk(buildCompletedLoaded(info.totalChunks, info.totalSize));
        setStatus('COMPLETED');
      } else {
        setStatus(info.status);
      }
    } catch (err) {
      setError(err.message || 'Failed to refresh status');
    }
  }, [file, uploadId, waitForFinalization]);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    pausedRef.current = false;
    workersRunning.current = false;
    abortActiveRequests();
    setFile(null);
    setUploadId(null);
    setStatuses({});
    setLoadedByChunk({});
    setTotalChunks(0);
    setStatus(INITIAL_STATUS);
    setError('');
    setSpeed(0);
    setStartedAt(null);
  }, [abortActiveRequests]);

  return {
    file,
    uploadId,
    statuses,
    loadedByChunk,
    totalChunks,
    status,
    error,
    speed,
    startedAt,
    uploadedBytes,
    progress,
    eta,
    selectFile,
    startUpload,
    pauseUpload,
    refreshStatus,
    reset,
  };
}
