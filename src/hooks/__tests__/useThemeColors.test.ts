import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettingsStore, defaultThemeColors } from '../../stores/settingsStore';
import { useThemeColors } from '../useThemeColors';

describe('useThemeColors', () => {
  beforeEach(() => {
    useSettingsStore.setState({ themeColors: { ...defaultThemeColors } });
    // Clear any previously set CSS vars
    const root = document.documentElement;
    root.style.cssText = '';
  });

  it('applies all ThemeColors as CSS custom properties on :root', () => {
    renderHook(() => useThemeColors());

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--ui-bg-app')).toBe('#181825');
    expect(root.style.getPropertyValue('--ui-panel-bg')).toBe('#1e1e2e');
    expect(root.style.getPropertyValue('--ui-panel-bg-alt')).toBe('#181825');
    expect(root.style.getPropertyValue('--ui-text-primary')).toBe('#cdd6f4');
    expect(root.style.getPropertyValue('--ui-text-muted')).toBe('#a6adc8');
    expect(root.style.getPropertyValue('--ui-border')).toBe('#313244');
    expect(root.style.getPropertyValue('--ui-accent')).toBe('#89b4fa');
    expect(root.style.getPropertyValue('--ui-danger')).toBe('#f38ba8');
    expect(root.style.getPropertyValue('--terminal-bg')).toBe('#0b0b0b');
    expect(root.style.getPropertyValue('--terminal-fg')).toBe('#cdd6f4');
    expect(root.style.getPropertyValue('--terminal-cursor')).toBe('#f5e0dc');
    expect(root.style.getPropertyValue('--terminal-selection')).toBe('#45475a80');
  });

  it('reacts to themeColors changes in the store', () => {
    renderHook(() => useThemeColors());

    act(() => {
      useSettingsStore.getState().updateThemeColor('accentColor', '#f5c2e7');
    });

    expect(document.documentElement.style.getPropertyValue('--ui-accent')).toBe('#f5c2e7');
  });

  it('updates all variables when multiple colors change', () => {
    renderHook(() => useThemeColors());

    act(() => {
      useSettingsStore.getState().updateThemeColor('appBackground', '#000000');
      useSettingsStore.getState().updateThemeColor('textPrimary', '#ffffff');
    });

    expect(document.documentElement.style.getPropertyValue('--ui-bg-app')).toBe('#000000');
    expect(document.documentElement.style.getPropertyValue('--ui-text-primary')).toBe('#ffffff');
  });
});
