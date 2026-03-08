# Cyber-Minimal Design System

This document captures the target visual direction for Obelisk's interface.

## Style Name

- Cyber-Minimalism
- Technical Dark Mode
- Developer-First UI

## Core Principles

1. Blueprint Grid Layout
- Use faint architectural grid lines in the background.
- Add precise corner/crosshair details where practical.
- Preserve generous negative space.

2. Typography Hierarchy
- Monospaced font for labels, headings, technical identifiers, and compact metadata.
- Clean sans-serif for paragraph-length body copy and descriptive text.
- System labels should be uppercase with increased letter spacing.

3. Restrained Color Discipline
- Base background: near-black (not pure black).
- Lines/borders: subtle low-opacity neutral lines.
- Text: bright primary + muted secondary grays.
- Accent: exactly one energetic neon accent color (orange/amber family), used sparingly.

4. Bounding Boxes Over Cards
- Prefer ghost borders and transparent surfaces over filled cards.
- Active state should rely on border emphasis and accent details, not heavy fills.

5. Technical Illustration Language
- Isometric/wireframe/glassmorphism style where visuals are used.
- Use glow/bloom only on active or high-priority signals.

## Token Baseline

```css
:root {
  --bg-base: #080808;
  --bg-surface: #121212;
  --text-primary: #f3f4f6;
  --text-secondary: #9ca3af;
  --text-muted: #4b5563;
  --accent-neon: #ff6a00;
  --border-grid: rgba(255, 255, 255, 0.05);
  --border-active: rgba(255, 255, 255, 0.15);
  --font-mono: "Fira Mono", monospace;
  --font-sans: "IBM Plex Sans", "Segoe UI", sans-serif;
}
```

## Implementation Notes

- Keep accent usage limited to active tab/item rings, selection highlights, and high-priority indicators.
- Avoid introducing additional chromatic accents (green/blue/purple) in normal UI states.
- Favor thin separators, ghost panels, and subtle gradients over heavy shadows and dense cards.
