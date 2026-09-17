import { useRef, useState } from 'react';
import { formatBytes } from '../utils/format';

export default function FileDropzone({ file, onFileSelect, disabled = false }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const choose = (candidate) => {
    if (candidate) onFileSelect(candidate);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) choose(event.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={`dropzone ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        disabled={disabled}
        onChange={(event) => choose(event.target.files?.[0])}
      />

      <div className="upload-icon" aria-hidden="true">↑</div>
      <div className="dropzone-copy">
        <strong>{file ? file.name : 'Drop a ZIP file here'}</strong>
        <span>
          {file
            ? `${formatBytes(file.size)} selected · click to choose another`
            : 'or click to browse from your computer'}
        </span>
      </div>
      <span className="zip-badge">ZIP only</span>
    </div>
  );
}
