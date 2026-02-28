import { useState, useEffect, type KeyboardEvent } from 'react';

export interface BrowserToolbarProps {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
}

const DANGEROUS_SCHEMES = /^(javascript|data|file|vbscript|blob):/i;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return trimmed;
  if (DANGEROUS_SCHEMES.test(trimmed)) {
    return '';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

export function BrowserToolbar({
  url,
  canGoBack,
  canGoForward,
  isLoading,
  onNavigate,
  onBack,
  onForward,
  onRefresh,
}: BrowserToolbarProps) {
  const [inputValue, setInputValue] = useState(url);

  useEffect(() => {
    setInputValue(url);
  }, [url]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const normalized = normalizeUrl(inputValue);
      if (normalized) {
        onNavigate(normalized);
      }
    }
  };

  return (
    <div style={toolbarStyle}>
      <button
        aria-label="Go back"
        disabled={!canGoBack}
        onClick={onBack}
        style={buttonStyle}
      >
        ◀
      </button>
      <button
        aria-label="Go forward"
        disabled={!canGoForward}
        onClick={onForward}
        style={buttonStyle}
      >
        ▶
      </button>
      <button
        aria-label="Refresh page"
        onClick={onRefresh}
        style={buttonStyle}
      >
        ↻
      </button>
      <input
        aria-label="URL"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        style={inputStyle}
      />
      {isLoading && <div role="progressbar" style={loadingStyle} />}
    </div>
  );
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 8px',
  backgroundColor: '#181825',
  borderBottom: '1px solid #313244',
};

const buttonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#cdd6f4',
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: '14px',
  borderRadius: '4px',
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  backgroundColor: '#1e1e2e',
  border: '1px solid #313244',
  borderRadius: '4px',
  color: '#cdd6f4',
  fontSize: '13px',
  outline: 'none',
};

const loadingStyle: React.CSSProperties = {
  width: '16px',
  height: '16px',
  border: '2px solid #313244',
  borderTop: '2px solid #89b4fa',
  borderRadius: '50%',
  animation: 'spin 1s linear infinite',
};
