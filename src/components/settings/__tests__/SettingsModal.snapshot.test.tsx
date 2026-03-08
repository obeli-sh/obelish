import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';

describe('SettingsModal snapshots', () => {
  it('matches snapshot when open', () => {
    const { container } = render(
      <SettingsModal isOpen={true} onClose={vi.fn()}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    expect(container).toMatchSnapshot();
  });

  it('matches snapshot when closed', () => {
    const { container } = render(
      <SettingsModal isOpen={false} onClose={vi.fn()}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    expect(container).toMatchSnapshot();
  });
});
