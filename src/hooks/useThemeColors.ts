import { useEffect } from 'react';
import { useSettingsStore, type ThemeColors } from '../stores/settingsStore';

const themeColorToCssVar: Record<keyof ThemeColors, string> = {
  appBackground: '--ui-bg-app',
  panelBackground: '--ui-panel-bg',
  panelBackgroundAlt: '--ui-panel-bg-alt',
  textPrimary: '--ui-text-primary',
  textMuted: '--ui-text-muted',
  borderColor: '--ui-border',
  accentColor: '--ui-accent',
  dangerColor: '--ui-danger',
  terminalBackground: '--terminal-bg',
  terminalForeground: '--terminal-fg',
  terminalCursor: '--terminal-cursor',
  terminalSelection: '--terminal-selection',
};

export function useThemeColors() {
  const themeColors = useSettingsStore((s) => s.themeColors);

  useEffect(() => {
    const root = document.documentElement;
    for (const [key, cssVar] of Object.entries(themeColorToCssVar)) {
      root.style.setProperty(cssVar, themeColors[key as keyof ThemeColors]);
    }
  }, [themeColors]);
}
