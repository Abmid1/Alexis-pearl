'use client';

/** Shown for listings that are unpublished, archived or never existed. */
export default function NotFound() {
  return (
    <div className="s-wrap" style={{ padding: '72px 16px' }}>
      <div className="s-empty">
        <h1 style={{ fontSize: 26 }}>This listing isn't available</h1>
        <p>It may have been let, sold or taken down by the agency, or the link may be mistyped.</p>
        <button className="s-btn s-btn-primary" onClick={() => history.back()}>Go back</button>
      </div>
    </div>
  );
}
