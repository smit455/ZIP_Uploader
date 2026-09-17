import MetricCard from './MetricCard';
import { formatBytes, formatTime } from '../utils/format';

const statusLabels = {
  IDLE: 'Ready',
  READY: 'Ready to upload',
  HANDSHAKING: 'Checking resume state',
  UPLOADING: 'Uploading',
  PAUSED: 'Paused',
  FINALIZING: 'Finalizing',
  COMPLETED: 'Completed',
  FAILED: 'Needs attention',
};

export default function UploadProgress({ progress, uploadedBytes, totalBytes, speed, eta, status }) {
  const label = statusLabels[status] || status;

  return (
    <div className="progress-section">
      <div className="progress-topline">
        <div>
          <span className="section-kicker">Upload progress</span>
          <h2>{progress.toFixed(1)}%</h2>
        </div>
        <div className="progress-status">{label}</div>
      </div>

      <div className="progress-track" aria-label={`Upload progress ${progress.toFixed(1)} percent`}>
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="progress-caption">
        <span>{formatBytes(uploadedBytes)} uploaded</span>
        <span>{formatBytes(totalBytes)} total</span>
      </div>

      <div className="metrics-grid">
        <MetricCard label="Transfer speed" value={`${formatBytes(speed)}/s`} detail="10-second rolling average" />
        <MetricCard label="Time remaining" value={formatTime(eta)} detail="Estimated from current speed" />
        <MetricCard label="Chunk policy" value="5 MB × 3" detail="Chunk size × max concurrency" />
      </div>
    </div>
  );
}
