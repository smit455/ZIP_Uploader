const legend = [
  ['PENDING', 'Pending'],
  ['UPLOADING', 'Uploading'],
  ['SUCCESS', 'Success'],
  ['ERROR', 'Error'],
];

export default function ChunkGrid({ totalChunks, statuses }) {
  if (!totalChunks) return null;

  return (
    <section className="chunk-section">
      <div className="section-heading-row">
        <div>
          <span className="section-kicker">Chunk monitor</span>
          <h2>Transfer map</h2>
        </div>
        <span className="chunk-count">{totalChunks} chunks</span>
      </div>

      <div className="legend">
        {legend.map(([key, label]) => (
          <span key={key}><i className={`legend-dot ${key}`} />{label}</span>
        ))}
      </div>

      <div className="chunk-grid">
        {Array.from({ length: totalChunks }, (_, index) => {
          const state = statuses[index] || 'PENDING';
          return (
            <div
              key={index}
              className={`chunk ${state}`}
              title={`Chunk ${index + 1}: ${state}`}
            >
              {index + 1}
            </div>
          );
        })}
      </div>
    </section>
  );
}
