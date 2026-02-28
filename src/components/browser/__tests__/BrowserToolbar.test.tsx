import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserToolbar } from '../BrowserToolbar';
import type { BrowserToolbarProps } from '../BrowserToolbar';

function makeProps(overrides: Partial<BrowserToolbarProps> = {}): BrowserToolbarProps {
  return {
    url: 'https://example.com',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    onNavigate: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

describe('BrowserToolbar', () => {
  it('renders_url_input_with_current_url', () => {
    render(<BrowserToolbar {...makeProps({ url: 'https://example.com' })} />);
    const input = screen.getByLabelText('URL') as HTMLInputElement;
    expect(input.value).toBe('https://example.com');
  });

  it('calls_onNavigate_on_enter', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<BrowserToolbar {...makeProps({ onNavigate })} />);
    const input = screen.getByLabelText('URL');

    await user.clear(input);
    await user.type(input, 'https://test.com{Enter}');

    expect(onNavigate).toHaveBeenCalledWith('https://test.com');
  });

  it('disables_back_button_when_canGoBack_is_false', () => {
    render(<BrowserToolbar {...makeProps({ canGoBack: false })} />);
    expect(screen.getByLabelText('Go back')).toBeDisabled();
  });

  it('disables_forward_button_when_canGoForward_is_false', () => {
    render(<BrowserToolbar {...makeProps({ canGoForward: false })} />);
    expect(screen.getByLabelText('Go forward')).toBeDisabled();
  });

  it('calls_onBack_when_back_clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<BrowserToolbar {...makeProps({ canGoBack: true, onBack })} />);

    await user.click(screen.getByLabelText('Go back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('calls_onForward_when_forward_clicked', async () => {
    const user = userEvent.setup();
    const onForward = vi.fn();
    render(<BrowserToolbar {...makeProps({ canGoForward: true, onForward })} />);

    await user.click(screen.getByLabelText('Go forward'));
    expect(onForward).toHaveBeenCalledOnce();
  });

  it('calls_onRefresh_when_refresh_clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<BrowserToolbar {...makeProps({ onRefresh })} />);

    await user.click(screen.getByLabelText('Refresh page'));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('normalizes_urls_without_protocol', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<BrowserToolbar {...makeProps({ onNavigate })} />);
    const input = screen.getByLabelText('URL');

    await user.clear(input);
    await user.type(input, 'example.com{Enter}');

    expect(onNavigate).toHaveBeenCalledWith('http://example.com');
  });

  it('shows_loading_indicator_when_isLoading_is_true', () => {
    render(<BrowserToolbar {...makeProps({ isLoading: true })} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('hides_loading_indicator_when_isLoading_is_false', () => {
    render(<BrowserToolbar {...makeProps({ isLoading: false })} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
