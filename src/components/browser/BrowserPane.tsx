import { useBrowser } from '../../hooks/useBrowser';
import { BrowserToolbar } from './BrowserToolbar';

export interface BrowserPaneProps {
  paneId: string;
  url: string;
  isActive: boolean;
}

export function BrowserPane({ paneId, url, isActive }: BrowserPaneProps) {
  const browser = useBrowser(paneId, url);

  return (
    <div data-active={isActive} style={containerStyle}>
      <BrowserToolbar
        url={browser.currentUrl}
        canGoBack={browser.canGoBack}
        canGoForward={browser.canGoForward}
        isLoading={browser.isLoading}
        onNavigate={browser.navigate}
        onBack={browser.goBack}
        onForward={browser.goForward}
        onRefresh={browser.refresh}
      />
      <iframe
        ref={browser.iframeRef}
        src={browser.currentUrl}
        title="Browser panel"
        sandbox="allow-scripts allow-forms allow-popups"
        allow="clipboard-read; clipboard-write"
        style={iframeStyle}
      />
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
};

const iframeStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  border: 'none',
};
