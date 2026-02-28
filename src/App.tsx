import { useEffect, useState } from 'react';
import { TerminalPane } from './components/terminal/TerminalPane';
import { tauriBridge } from './lib/tauri-bridge';

function App() {
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    tauriBridge.pty.spawn({}).then((result) => {
      if (mounted) setPtyId(result.ptyId);
    }).catch((err: unknown) => {
      if (mounted) setError(String(err instanceof Error ? err.message : err));
    });
    return () => { mounted = false; };
  }, []);

  if (error) {
    return <div style={{ color: 'red', padding: 20 }}>Failed to spawn terminal: {error}</div>;
  }

  if (!ptyId) {
    return <div style={{ padding: 20 }}>Loading terminal...</div>;
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <TerminalPane paneId="main" ptyId={ptyId} isActive={true} />
    </div>
  );
}

export default App;
