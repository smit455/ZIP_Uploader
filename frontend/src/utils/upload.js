export const CHUNK_SIZE = 5 * 1024 * 1024;
export const MAX_CONCURRENCY = 3;
export const MAX_RETRIES = 3;

export function getChunkSize(fileSize, index) {
  const start = index * CHUNK_SIZE;
  return Math.min(CHUNK_SIZE, fileSize - start);
}

export function getChunkCount(fileSize) {
  return Math.ceil(fileSize / CHUNK_SIZE);
}

export function buildInitialChunkState(totalChunks, fileSize, uploadedChunks) {
  const uploadedSet = new Set(uploadedChunks.map(Number));
  const statuses = {};
  const loadedByChunk = {};

  for (let index = 0; index < totalChunks; index += 1) {
    const uploaded = uploadedSet.has(index);
    statuses[index] = uploaded ? 'SUCCESS' : 'PENDING';
    loadedByChunk[index] = uploaded ? getChunkSize(fileSize, index) : 0;
  }

  return { statuses, loadedByChunk };
}

export function getPendingChunks(totalChunks, uploadedChunks) {
  const uploadedSet = new Set(uploadedChunks.map(Number));
  return Array.from({ length: totalChunks }, (_, index) => index)
    .filter((index) => !uploadedSet.has(index));
}

export function isRetryable(error) {
  return !error.status || [408, 429, 500, 502, 503, 504].includes(error.status);
}

export function getBackoff(attempt) {
  return 1000 * (2 ** attempt) + Math.floor(Math.random() * 250);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
