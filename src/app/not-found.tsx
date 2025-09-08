export default function NotFound() {
  return (
    <main style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      flexDirection: 'column',
      gap: '0.5rem'
    }}>
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist.</p>
    </main>
  );
}


