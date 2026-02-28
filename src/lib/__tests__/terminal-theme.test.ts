// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { catppuccinMocha } from '../terminal-theme';

const HEX_COLOR_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

describe('catppuccinMocha terminal theme', () => {
  it('has the correct background (Base)', () => {
    expect(catppuccinMocha.background).toBe('#1e1e2e');
  });

  it('has the correct foreground (Text)', () => {
    expect(catppuccinMocha.foreground).toBe('#cdd6f4');
  });

  it('has the correct cursor color (Rosewater)', () => {
    expect(catppuccinMocha.cursor).toBe('#f5e0dc');
  });

  it('has the correct cursorAccent (Base)', () => {
    expect(catppuccinMocha.cursorAccent).toBe('#1e1e2e');
  });

  it('has the correct selectionBackground (Surface2 40%)', () => {
    expect(catppuccinMocha.selectionBackground).toBe('#585b7066');
  });

  it('has the correct selectionForeground (Text)', () => {
    expect(catppuccinMocha.selectionForeground).toBe('#cdd6f4');
  });

  it('has the correct selectionInactiveBackground (Surface2 27%)', () => {
    expect(catppuccinMocha.selectionInactiveBackground).toBe('#585b7044');
  });

  describe('ANSI colors', () => {
    it('has black/brightBlack (Surface1/Surface2)', () => {
      expect(catppuccinMocha.black).toBe('#45475a');
      expect(catppuccinMocha.brightBlack).toBe('#585b70');
    });

    it('has red/brightRed', () => {
      expect(catppuccinMocha.red).toBe('#f38ba8');
      expect(catppuccinMocha.brightRed).toBe('#f38ba8');
    });

    it('has green/brightGreen', () => {
      expect(catppuccinMocha.green).toBe('#a6e3a1');
      expect(catppuccinMocha.brightGreen).toBe('#a6e3a1');
    });

    it('has yellow/brightYellow', () => {
      expect(catppuccinMocha.yellow).toBe('#f9e2af');
      expect(catppuccinMocha.brightYellow).toBe('#f9e2af');
    });

    it('has blue/brightBlue', () => {
      expect(catppuccinMocha.blue).toBe('#89b4fa');
      expect(catppuccinMocha.brightBlue).toBe('#89b4fa');
    });

    it('has magenta/brightMagenta (Pink)', () => {
      expect(catppuccinMocha.magenta).toBe('#f5c2e7');
      expect(catppuccinMocha.brightMagenta).toBe('#f5c2e7');
    });

    it('has cyan/brightCyan (Teal)', () => {
      expect(catppuccinMocha.cyan).toBe('#94e2d5');
      expect(catppuccinMocha.brightCyan).toBe('#94e2d5');
    });

    it('has white/brightWhite (Subtext1/Subtext0)', () => {
      expect(catppuccinMocha.white).toBe('#bac2de');
      expect(catppuccinMocha.brightWhite).toBe('#a6adc8');
    });
  });

  it('all color values are valid hex format', () => {
    for (const [key, value] of Object.entries(catppuccinMocha)) {
      expect(value, `${key} should be a valid hex color`).toMatch(HEX_COLOR_RE);
    }
  });
});
