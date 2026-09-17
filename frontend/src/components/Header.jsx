export default function Header() {
  return (
    <header className="app-header">
      <div className="brand-mark" aria-hidden="true">U</div>
      <div>
        <p className="eyebrow">Resumable transfer</p>
        <h1>Large File Uploader</h1>
        <p className="subtitle">
          Reliable 5 MB chunk uploads with resume, retry, integrity checks, and ZIP inspection.
        </p>
      </div>
    </header>
  );
}
