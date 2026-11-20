export default function Loading() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="Loading LocStock">
      <div className="skeleton skeleton--title" style={{ maxWidth: '30%' }} />
      <div className="skeleton skeleton--block" style={{ minHeight: 320 }} />
      <div className="skeleton-grid">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton skeleton--block" style={{ minHeight: 90 }} />
        ))}
      </div>
    </div>
  )
}
