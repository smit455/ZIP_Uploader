import { useEffect } from 'react';
import Header from './components/Header';
import FileDropzone from './components/FileDropzone';
import UploadProgress from './components/UploadProgress';
import ChunkGrid from './components/ChunkGrid';
import UploadActions from './components/UploadActions';
import UploadHistory from './components/UploadHistory';
import { useUploadHistory } from './hooks/useUploadHistory';
import { useUploader } from './hooks/useUploader';

export default function App() {
  const history = useUploadHistory();
  const uploader = useUploader({ onUploadChanged: history.refresh });

  useEffect(() => {
    document.title = 'Large File Uploader';
  }, []);

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <div className="app-container">
        <Header />

        <section className="workspace-card">
          <div className="workspace-intro">
            <div>
              <span className="section-kicker">New transfer</span>
              <h2>Upload a large ZIP safely</h2>
              <p>
                Files are split into 5 MB chunks, uploaded with three concurrent workers,
                persisted in MySQL, and finalized asynchronously on the server.
              </p>
            </div>
            <div className="architecture-badge">
              <span>5 MB</span>
              <small>chunk size</small>
            </div>
          </div>

          <FileDropzone
            file={uploader.file}
            onFileSelect={uploader.selectFile}
            disabled={['UPLOADING', 'HANDSHAKING', 'FINALIZING'].includes(uploader.status)}
          />

          {uploader.error && (
            <div className="alert error-alert" role="alert">
              <strong>Upload issue</strong>
              <span>{uploader.error}</span>
            </div>
          )}

          {uploader.file && (
            <>
              <div className="selected-file">
                <div className="selected-file-main">
                  <span className="file-type large">ZIP</span>
                  <div>
                    <strong>{uploader.file.name}</strong>
                    <span>{uploader.totalChunks} chunks · Upload #{uploader.uploadId || 'new'}</span>
                  </div>
                </div>
                <span className="file-size">{new Intl.NumberFormat().format(uploader.file.size)} bytes</span>
              </div>

              <UploadProgress
                progress={uploader.progress}
                uploadedBytes={uploader.uploadedBytes}
                totalBytes={uploader.file.size}
                speed={uploader.speed}
                eta={uploader.eta}
                status={uploader.status}
              />

              <UploadActions
                status={uploader.status}
                file={uploader.file}
                onStart={uploader.startUpload}
                onPause={uploader.pauseUpload}
                onRefresh={uploader.refreshStatus}
                onReset={uploader.reset}
              />

              {uploader.status === 'FINALIZING' && (
                <div className="alert info-alert">
                  <strong>Finalization in progress</strong>
                  <span>The upload is safely stored. A background worker is calculating SHA-256 and inspecting the ZIP.</span>
                </div>
              )}

              {uploader.status === 'COMPLETED' && (
                <div className="alert success-alert">
                  <strong>Upload completed</strong>
                  <span>The assembled file passed backend finalization and ZIP inspection.</span>
                </div>
              )}

              <ChunkGrid totalChunks={uploader.totalChunks} statuses={uploader.statuses} />
            </>
          )}
        </section>

        <UploadHistory
          uploads={history.uploads}
          loading={history.loading}
          error={history.error}
          onRefresh={history.refresh}
          onDelete={history.remove}
        />

        <footer className="app-footer">
          <span>Resumable uploads</span>
          <span>•</span>
          <span>Streaming PHP I/O</span>
          <span>•</span>
          <span>MySQL source of truth</span>
        </footer>
      </div>
    </main>
  );
}
