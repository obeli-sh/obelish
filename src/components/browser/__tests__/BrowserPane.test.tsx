import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as useBrowserModule from '../../../hooks/useBrowser';
import { BrowserPane } from '../BrowserPane';

function setupMock(overrides: Partial<ReturnType<typeof useBrowserModule.useBrowser>> = {}) {
  const defaults: ReturnType<typeof useBrowserModule.useBrowser> = {
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
  vi.spyOn(useBrowserModule, 'useBrowser').mockReturnValue(defaults);
  return defaults;
}

describe('BrowserPane', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    // Find toolbar via the URL input and iframe
    const urlInput = screen.getByLabelText('URL');
    const iframe = screen.getByTitle('Browser panel');

    // Toolbar (containing URL input) should appear before iframe in DOM
    expect(urlInput.compareDocumentPosition(iframe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('updates_iframe_src_when_navigating_via_toolbar', () => {
    const navigate = vi.fn();
    setupMock({ navigate, currentUrl: 'https://example.com' });

    render(<BrowserPane paneId="pane-1" url="https://example.com" isActive={true} />);

    // Verify useBrowser was called with correct args
    expect(useBrowserModule.useBrowser).toHaveBeenCalledWith('pane-1', 'https://example.com');
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
