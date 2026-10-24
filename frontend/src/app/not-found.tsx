export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#FAF9F7', color: '#17161C', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Page not found</h1>
        <p style={{ color: '#5F5B66' }}>This agency page doesn't exist or is currently offline. Check the link you were given.</p>
      </div>
    </div>
  );
}
