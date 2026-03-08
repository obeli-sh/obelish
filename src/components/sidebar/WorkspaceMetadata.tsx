import { useGitInfo } from '../../hooks/useGitInfo';
import { usePaneCwd } from '../../hooks/usePaneCwd';
import { usePortScanner } from '../../hooks/usePortScanner';

interface WorkspaceMetadataProps {
  paneId: string;
  ptyId: string | null;
}

function shortenPath(path: string): string {
  const home = path.replace(/^\/home\/[^/]+/, '~').replace(/^\/Users\/[^/]+/, '~');
  return home;
}

export function WorkspaceMetadata({ paneId, ptyId }: WorkspaceMetadataProps) {
  const gitInfo = useGitInfo(paneId);
  const ports = usePortScanner(paneId);
  const cwd = usePaneCwd(ptyId);

  if (!gitInfo && ports.length === 0 && !cwd) return null;

  return (
    <div style={containerStyle}>
      {cwd && (
        <div data-testid="cwd-info" style={cwdStyle} title={cwd}>
          {shortenPath(cwd)}
        </div>
      )}
      {gitInfo && (
        <div data-testid="git-info" style={rowStyle}>
          <span style={branchStyle}>
            {gitInfo.branch}
            {gitInfo.isDirty && <span style={dirtyStyle}>*</span>}
          </span>
          {(gitInfo.ahead > 0 || gitInfo.behind > 0) && (
            <span style={syncStyle}>
              {gitInfo.ahead > 0 && <span>↑{gitInfo.ahead}</span>}
              {gitInfo.behind > 0 && <span>↓{gitInfo.behind}</span>}
            </span>
          )}
        </div>
      )}
      {ports.length > 0 && (
        <div data-testid="port-info" style={rowStyle}>
          {ports.map((p) => (
            <span key={p.port} style={portStyle}>
              :{p.port}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  padding: '0 8px 4px',
  fontSize: '11px',
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.04em',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '6px',
  alignItems: 'center',
  flexWrap: 'wrap',
};

const branchStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const dirtyStyle: React.CSSProperties = {
  color: 'var(--ui-accent)',
};

const syncStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
};

const cwdStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const portStyle: React.CSSProperties = {
  color: 'var(--ui-accent)',
};
