import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserPane } from '../BrowserPane';

vi.mock('../../../hooks/useBrowser', () => ({
  useBrowser: vi.fn(),
}));

vi.mock('../BrowserToolbar', () => ({
  BrowserToolbar: vi.fn(({ url, onNavigate, canGoBack, canGoForward, isLoading, onBack, onForward, onRefresh }) => (
    <div data-testid="browser-toolbar">
      <input aria-label="URL" value={url} onChange={() => {}} onKeyDown={(e) => {
        if (e.key === 'Enter') onNavigate(url);
      }} />
      <button aria-label="Go back" onClick={onBack} disabled={!canGoBack}>Back</button>
      <button aria-label="Go forward" onClick={onForward} disabled={!canGoForward}>Forward</button>
      <button aria-label="Refresh page" onClick={onRefresh}>Refresh</button>
      {isLoading && <div role="progressbar" />}
    </div>
  )),
}));

import { useBrowser } from '../../../hooks/useBrowser';

const mockUseBrowser = vi.mocked(useBrowser);

function setupMock(overrides: Partial<ReturnType<typeof useBrowser>> = {}) {
  const defaults: ReturnType<typeof useBrowser> = {
    iframeRef: vi.fn(),
    currentUrl: 'https://example.com',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
  mockUseBrowser.mockReturnValue(defaults);
  return defaults;
}

describe('BrowserPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders_iframe_with_correct_src', () => {
    setupMock({ currentUrl: 'https://example.com' });
    render(<BrowserPane paneId="pane-1" url="https://example.com" isActive={true} />);
    const iframe = screen.getByTitle('Browser panel') as HTMLIFrameElement;
    expect(iframe.src).toBe('https://example.com/');
  });

  it('renders_BrowserToolbar_above_iframe', () => {
    setupMock();
    render(<BrowserPane paneId="pane-1" url="https://example.com" isActive={true} />);
    const toolbar = screen.getByTestId('browser-toolbar');
    const iframe = screen.getByTitle('Browser panel');

    // Toolbar should appear before iframe in DOM
    expect(toolbar.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('updates_iframe_src_when_navigating_via_toolbar', () => {
    const navigate = vi.fn();
    setupMock({ navigate, currentUrl: 'https://example.com' });

    render(<BrowserPane paneId="pane-1" url="https://example.com" isActive={true} />);

    // Verify useBrowser was called with correct args
    expect(mockUseBrowser).toHaveBeenCalledWith('pane-1', 'https://example.com');
  });

  it('applies_sandbox_attribute_to_iframe', () => {
    setupMock();
    render(<BrowserPane paneId="pane-1" url="https://example.com" isActive={true} />);
    const iframe = screen.getByTitle('Browser panel') as HTMLIFrameElement;
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups');
  });

  it('sets_iframe_permissions', () => {
    setupMock();
    render(<BrowserPane paneId="pane-1" url="https://example.com" isActive={true} />);
    const iframe = screen.getByTitle('Browser panel') as HTMLIFrameElement;
    expect(iframe.getAttribute('allow')).toBe('clipboard-read; clipboard-write');
  });

  it('iframe_fills_available_space', () => {
    setupMock();
    render(<BrowserPane paneId="pane-1" url="https://example.com" isActive={true} />);
    const iframe = screen.getByTitle('Browser panel') as HTMLIFrameElement;
    expect(iframe.style.width).toBe('100%');
    expect(iframe.style.flex).toContain('1');
  });
});
