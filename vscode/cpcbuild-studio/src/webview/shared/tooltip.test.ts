import { describe, expect, it } from 'vitest';
import { anchorLive, placeTip, tipText } from './tooltip';

describe('tooltips', () => {
  it('text: the label, plus the shortcut or (disabled) the reason', () => {
    expect(tipText({ label: 'Pencil' })).toBe('Pencil');
    expect(tipText({ label: 'Pencil', shortcut: 'B' })).toBe('Pencil (B)');
    expect(tipText({ label: 'Undo', shortcut: 'Ctrl+Z', disabled: true, why: 'nothing to undo' })).toBe('Undo (nothing to undo)');
    expect(tipText({ label: 'Undo', shortcut: 'Ctrl+Z', disabled: true })).toBe('Undo (Ctrl+Z)');
    expect(tipText({ label: 'Undo', shortcut: 'Ctrl+Z', why: 'ignored when enabled' })).toBe('Undo (Ctrl+Z)');
  });
  const view = { width: 400, height: 300 };
  const tip = { width: 100, height: 24 };
  it('placement: centred below the button', () => {
    expect(placeTip({ left: 100, top: 10, width: 20, height: 20 }, tip, view)).toEqual({ left: 60, top: 34 });
  });
  it('placement: kept inside the viewport on both sides', () => {
    expect(placeTip({ left: 0, top: 10, width: 20, height: 20 }, tip, view).left).toBe(4);
    expect(placeTip({ left: 390, top: 10, width: 10, height: 20 }, tip, view).left).toBe(296);
  });
  it('placement: above the button when there is no room below', () => {
    expect(placeTip({ left: 100, top: 280, width: 20, height: 20 }, tip, view).top).toBe(252);
  });
});

describe('anchorLive', () => {
  it('is true only for an anchor still in the document', () => {
    expect(anchorLive({ isConnected: true })).toBe(true);
    expect(anchorLive({ isConnected: false })).toBe(false);
    expect(anchorLive(null)).toBe(false);
    expect(anchorLive(undefined)).toBe(false);
  });
});
