import { useGitInfo } from '../../hooks/useGitInfo';
import { usePortScanner } from '../../hooks/usePortScanner';

interface WorkspaceMetadataProps {
  paneId: string;
}

export function WorkspaceMetadata({ paneId }: WorkspaceMetadataProps) {
  const gitInfo = useGitInfo(paneId);
  const ports = usePortScanner(paneId);

  if (!gitInfo && ports.length === 0) return null;

  return (
    <div style={containerStyle}>
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
  color: '#a6adc8',
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
  color: '#f9e2af',
};

const syncStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
};

const portStyle: React.CSSProperties = {
  color: '#94e2d5',
};
