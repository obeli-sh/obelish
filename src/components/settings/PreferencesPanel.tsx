import type React from 'react';
import { useMemo, useState } from 'react';
import type { Command } from '../../lib/commands';
import type { KeyBinding } from '../../lib/keybinding-utils';
import { KeybindingEditor } from './KeybindingEditor';
import { ShellSelector } from './ShellSelector';
import { useSettingsStore, type ThemeColors, type WorkspaceLayoutPreset } from '../../stores/settingsStore';

type PreferenceCategory = 'general' | 'hotkeys' | 'theme';

interface PreferencesPanelProps {
  commands: Command[];
  keybindings: Record<string, KeyBinding>;
  onKeybindingUpdate: (commandId: string, binding: KeyBinding) => void;
  onKeybindingReset: (commandId: string) => void;
}

interface ColorField {
  key: keyof ThemeColors;
  label: string;
}

const colorFields: ColorField[] = [
  { key: 'appBackground', label: 'App Background' },
  { key: 'panelBackground', label: 'Panel Background' },
  { key: 'panelBackgroundAlt', label: 'Panel Alternate Background' },
  { key: 'textPrimary', label: 'Primary Text' },
  { key: 'textMuted', label: 'Muted Text' },
  { key: 'borderColor', label: 'Border' },
  { key: 'accentColor', label: 'Accent' },
  { key: 'dangerColor', label: 'Danger' },
  { key: 'terminalBackground', label: 'Terminal Background' },
  { key: 'terminalForeground', label: 'Terminal Foreground' },
  { key: 'terminalCursor', label: 'Terminal Cursor' },
  { key: 'terminalSelection', label: 'Terminal Selection' },
];

const workspaceLayoutOptions: Array<{ value: WorkspaceLayoutPreset; label: string }> = [
  { value: 'single', label: 'Single Pane' },
  { value: 'side-by-side', label: 'Side by Side' },
  { value: 'stacked', label: 'Stacked' },
];

function normalizeColorValue(value: string): string {
  if (/^#[0-9a-fA-F]{6,8}$/.test(value)) {
    return value.slice(0, 7);
  }
  return '#000000';
}

function categoryButtonLabel(category: PreferenceCategory): string {
  switch (category) {
    case 'general': return 'General';
    case 'hotkeys': return 'Hotkeys';
    case 'theme': return 'Theme';
  }
}

export function PreferencesPanel({
  commands,
  keybindings,
  onKeybindingUpdate,
  onKeybindingReset,
}: PreferencesPanelProps) {
  const [activeCategory, setActiveCategory] = useState<PreferenceCategory>('general');

  const preferredWorkspaceLayout = useSettingsStore((s) => s.preferredWorkspaceLayout);
  const showAllProjects = useSettingsStore((s) => s.showAllProjects);
  const terminalFontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily);
  const uiFontSize = useSettingsStore((s) => s.uiFontSize);
  const themeColors = useSettingsStore((s) => s.themeColors);

  const updatePreferredWorkspaceLayout = useSettingsStore((s) => s.updatePreferredWorkspaceLayout);
  const updateShowAllProjects = useSettingsStore((s) => s.updateShowAllProjects);
  const updateTerminalFontFamily = useSettingsStore((s) => s.updateFontFamily);
  const updateTerminalFontSize = useSettingsStore((s) => s.updateFontSize);
  const updateUiFontFamily = useSettingsStore((s) => s.updateUiFontFamily);
  const updateUiFontSize = useSettingsStore((s) => s.updateUiFontSize);
  const updateThemeColor = useSettingsStore((s) => s.updateThemeColor);

  const categories = useMemo<PreferenceCategory[]>(
    () => ['general', 'hotkeys', 'theme'],
    [],
  );

  return (
    <div style={wrapperStyle}>
      <h2 style={titleStyle}>Preferences</h2>
      <div style={layoutStyle}>
        <div style={categoryColumnStyle}>
          {categories.map((category) => {
            const selected = activeCategory === category;
            return (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                aria-pressed={selected}
                style={{
                  ...categoryButtonStyle,
                  backgroundColor: selected ? 'color-mix(in srgb, var(--ui-accent) 12%, transparent)' : 'transparent',
                  color: 'var(--ui-text-primary)',
                  borderColor: selected ? 'var(--ui-accent)' : 'var(--ui-border)',
                  borderLeft: selected ? '2px solid var(--ui-accent)' : '2px solid transparent',
                }}
              >
                {categoryButtonLabel(category)}
              </button>
            );
          })}
        </div>
        <div style={contentStyle}>
          {activeCategory === 'general' && (
            <div style={sectionStyle}>
              <h3 style={sectionTitleStyle}>General</h3>
              <label style={fieldLabelStyle}>
                Preferred New Workspace Layout
                <select
                  aria-label="Preferred New Workspace Layout"
                  value={preferredWorkspaceLayout}
                  onChange={(e) => updatePreferredWorkspaceLayout(e.target.value as WorkspaceLayoutPreset)}
                  style={fieldControlStyle}
                >
                  {workspaceLayoutOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  aria-label="Show All Projects in Sidebar"
                  checked={showAllProjects}
                  onChange={(e) => updateShowAllProjects(e.target.checked)}
                  style={checkboxStyle}
                />
                Show All Projects in Sidebar
              </label>
              <ShellSelector />
            </div>
          )}

          {activeCategory === 'hotkeys' && (
            <div style={sectionStyle}>
              <KeybindingEditor
                commands={commands}
                keybindings={keybindings}
                onUpdate={onKeybindingUpdate}
                onReset={onKeybindingReset}
              />
            </div>
          )}

          {activeCategory === 'theme' && (
            <div style={sectionStyle}>
              <h3 style={sectionTitleStyle}>Theme</h3>
              <div style={themeGridStyle}>
                <label style={fieldLabelStyle}>
                  UI Font Family
                  <input
                    aria-label="UI Font Family"
                    type="text"
                    value={uiFontFamily}
                    onChange={(e) => updateUiFontFamily(e.target.value)}
                    style={fieldControlStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  UI Font Size
                  <input
                    aria-label="UI Font Size"
                    type="number"
                    min={10}
                    max={24}
                    value={uiFontSize}
                    onChange={(e) => updateUiFontSize(Number(e.target.value))}
                    style={fieldControlStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Terminal Font Family
                  <input
                    aria-label="Terminal Font Family"
                    type="text"
                    value={terminalFontFamily}
                    onChange={(e) => updateTerminalFontFamily(e.target.value)}
                    style={fieldControlStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Terminal Font Size
                  <input
                    aria-label="Terminal Font Size"
                    type="number"
                    min={8}
                    max={40}
                    value={terminalFontSize}
                    onChange={(e) => updateTerminalFontSize(Number(e.target.value))}
                    style={fieldControlStyle}
                  />
                </label>
              </div>
              <div style={colorGridStyle}>
                {colorFields.map((field) => (
                  <label key={field.key} style={fieldLabelStyle}>
                    {field.label}
                    <div style={colorInputRowStyle}>
                      <input
                        aria-label={field.label}
                        type="color"
                        value={normalizeColorValue(themeColors[field.key])}
                        onChange={(e) => updateThemeColor(field.key, e.target.value)}
                        style={colorInputStyle}
                      />
                      <input
                        aria-label={`${field.label} Hex`}
                        type="text"
                        value={themeColors[field.key]}
                        onChange={(e) => updateThemeColor(field.key, e.target.value)}
                        style={fieldControlStyle}
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const wrapperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const titleStyle: React.CSSProperties = {
  color: 'var(--ui-text-primary)',
  margin: 0,
  fontSize: 16,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.08em',
};

const layoutStyle: React.CSSProperties = {
  display: 'flex',
  gap: 18,
  alignItems: 'flex-start',
};

const categoryColumnStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 140,
};

const categoryButtonStyle: React.CSSProperties = {
  border: '1px solid',
  borderRadius: 'var(--ui-radius)',
  padding: '8px 10px',
  fontSize: 11,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'all 120ms ease',
};

const contentStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  maxHeight: '68vh',
  overflowY: 'auto',
  paddingRight: 4,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const sectionTitleStyle: React.CSSProperties = {
  color: 'var(--ui-text-primary)',
  margin: 0,
  fontSize: 12,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.08em',
};

const fieldLabelStyle: React.CSSProperties = {
  color: 'var(--ui-text-muted)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 11,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const fieldControlStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 'var(--ui-radius)',
  border: '1px solid var(--ui-border)',
  color: 'var(--ui-text-primary)',
  backgroundColor: 'var(--ui-panel-bg)',
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.04em',
  textTransform: 'none',
};

const themeGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const colorGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
};

const colorInputRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

const colorInputStyle: React.CSSProperties = {
  width: 44,
  height: 34,
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  backgroundColor: 'transparent',
  padding: 2,
};

const checkboxLabelStyle: React.CSSProperties = {
  color: 'var(--ui-text-muted)',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const checkboxStyle: React.CSSProperties = {
  accentColor: 'var(--ui-accent)',
  width: 16,
  height: 16,
  cursor: 'pointer',
};
