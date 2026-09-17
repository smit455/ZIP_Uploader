const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

async function parseResponse(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    // Some errors may not include a JSON response.
  }

  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = body.code;
    throw error;
  }

  return body;
}

export async function apiJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  return parseResponse(response);
}

export function getApiBase() {
  return API_BASE;
}

export function handshake(file) {
  return apiJson('/api/uploads/handshake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      lastModified: file.lastModified,
    }),
  });
}

export function getUploadStatus(uploadId) {
  return apiJson(`/api/uploads/${uploadId}`);
}

export function getUploads() {
  return apiJson('/api/uploads');
}

export function getZipContents(uploadId) {
  return apiJson(`/api/uploads/${uploadId}/contents`);
}

export function deleteUpload(uploadId) {
  return apiJson(`/api/uploads/${uploadId}`, { method: 'DELETE' });
}

export function finalizeUpload(uploadId) {
  return apiJson(`/api/uploads/${uploadId}/finalize`, { method: 'POST' });
}

export function uploadChunk(uploadId, file, index, onProgress, registerXhr) {
  const chunkSize = 5 * 1024 * 1024;
  const start = index * chunkSize;
  const end = Math.min(start + chunkSize, file.size);
  const blob = file.slice(start, end);
  const expectedLength = end - start;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    registerXhr?.(xhr);

    xhr.open('PUT', `${API_BASE}/api/uploads/${uploadId}/chunks/${index}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Chunk-Length', String(expectedLength));
    xhr.timeout = 2 * 60 * 1000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded);
    };

    xhr.onload = () => {
      let body = {};
      try {
        body = JSON.parse(xhr.responseText || '{}');
      } catch {
        // Invalid JSON is handled as a generic HTTP error.
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }

      const error = new Error(body.error || `HTTP ${xhr.status}`);
      error.status = xhr.status;
      error.code = body.code;
      reject(error);
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Request timeout'));
    xhr.onabort = () => reject(new Error('Paused'));
    xhr.send(blob);
  });
}
