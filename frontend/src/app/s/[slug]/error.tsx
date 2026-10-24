'use client';

/** Friendly fallback if the listings service is unreachable. */
export default function SiteError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="s-wrap" style={{ padding: '64px 16px' }}>
      <div className="s-empty">
        <h1 style={{ fontSize: 24 }}>We couldn't load this page</h1>
        <p>Please check your connection and try again in a moment.</p>
        <button className="s-btn s-btn-primary" onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
