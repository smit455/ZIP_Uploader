import { useState } from 'react';
import { getZipContents } from '../services/api';
import { formatBytes, formatDate } from '../utils/format';

function StatusPill({ status }) {
  return <span className={`status-pill ${status.toLowerCase()}`}>{status}</span>;
}

export default function UploadHistory({ uploads, loading, error, onRefresh, onDelete }) {
  const [selected, setSelected] = useState(null);
  const [loadingContentsId, setLoadingContentsId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  async function showContents(upload) {
    try {
      setLoadingContentsId(upload.id);

      const data = await getZipContents(upload.id);

      setSelected({
        ...upload,
        entries: data.entries || [],
      });
    } catch (err) {
      window.alert(err.message || 'Unable to inspect ZIP');
    } finally {
      setLoadingContentsId(null);
    }
  }

  async function handleDelete(upload) {
    const confirmed = window.confirm(
      `Delete "${upload.filename}"? This removes the stored ZIP and its database records.`,
    );
    if (!confirmed) return;

    try {
      setDeleteId(upload.id);
      await onDelete(upload.id);
    } catch (err) {
      window.alert(err.message || 'Unable to delete upload');
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <section className="history-panel">
      <div className="section-heading-row history-heading">
        <div>
          <span className="section-kicker">Persistent storage</span>
          <h2>Upload history</h2>
          <p>Every upload is tracked by MySQL and stored independently from the browser session.</p>
        </div>
        <button className="ghost-button" onClick={onRefresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="alert error-alert">{error}</div>}

      {loading && uploads.length === 0 ? (
        <div className="empty-state">Loading upload history…</div>
      ) : uploads.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◫</div>
          <strong>No uploads yet</strong>
          <span>Your completed and in-progress uploads will appear here.</span>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Chunks</th>
                <th>Status</th>
                <th>SHA-256</th>
                <th>Created</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {uploads.map((upload) => (
                <tr key={upload.id}>
                  <td>
                    <div className="file-cell">
                      <span className="file-type">ZIP</span>
                      <div>
                        <strong title={upload.filename}>{upload.filename}</strong>
                        <small>Upload #{upload.id}</small>
                      </div>
                    </div>
                  </td>
                  <td>{formatBytes(Number(upload.total_size))}</td>
                  <td>{upload.successful_chunks} / {upload.total_chunks}</td>
                  <td><StatusPill status={upload.status} /></td>
                  <td>
                    <code title={upload.final_hash || ''}>
                      {upload.final_hash ? `${upload.final_hash.slice(0, 12)}…` : '—'}
                    </code>
                  </td>
                  <td>{formatDate(upload.created_at)}</td>
                  <td>
                    <div className="table-actions">
                      {upload.status === 'COMPLETED' && (
                        <button
                          className="small-button"
                          onClick={() => showContents(upload)}
                          disabled={loadingContentsId !== null}
                        >
                          {loadingContentsId === upload.id ? 'Reading…' : 'View ZIP'}
                        </button>
                      )}
                      <button
                        className="small-button danger-button"
                        disabled={deleteId === upload.id}
                        onClick={() => handleDelete(upload)}
                      >
                        {deleteId === upload.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="section-kicker">ZIP inspection</span>
                <h3>{selected.filename}</h3>
              </div>
              <button className="icon-button" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>

            <div className="modal-summary">
              <span>{selected.entries.length} top-level entries</span>
              <span>{formatBytes(Number(selected.total_size))}</span>
            </div>

            <div className="entry-list">
              {selected.entries.map((entry, index) => (
                <div className="entry-row" key={`${entry.name}-${index}`}>
                  <span>▧</span>
                  <strong>{entry.name}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
