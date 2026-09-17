export default function UploadActions({ status, file, onStart, onPause, onRefresh, onReset }) {
  if (!file) return null;

  return (
    <div className="action-row">
      {['READY', 'FAILED', 'PAUSED'].includes(status) && (
        <button className="primary-button" onClick={onStart}>
          {status === 'PAUSED' ? 'Resume upload' : status === 'FAILED' ? 'Retry upload' : 'Start upload'}
        </button>
      )}

      {['UPLOADING', 'HANDSHAKING'].includes(status) && (
        <button className="secondary-button" onClick={onPause}>Pause</button>
      )}

      {status !== 'IDLE' && (
        <button className="ghost-button" onClick={onRefresh}>Refresh state</button>
      )}

      {['COMPLETED', 'FAILED', 'PAUSED'].includes(status) && (
        <button className="ghost-button" onClick={onReset}>Choose another file</button>
      )}
    </div>
  );
}
