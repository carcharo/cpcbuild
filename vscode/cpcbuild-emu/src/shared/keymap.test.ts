import { describe, expect, it } from 'vitest';
import { usbFromCode } from './keymap';

describe('keymap', () => {
  it('maps letters, digits, arrows, modifiers and function keys to USB HID scancodes', () => {
    expect(usbFromCode('KeyA')).toBe(4);
    expect(usbFromCode('KeyZ')).toBe(29);
    expect(usbFromCode('Digit1')).toBe(30);
    expect(usbFromCode('Digit0')).toBe(39);
    expect(usbFromCode('Enter')).toBe(40);
    expect(usbFromCode('Space')).toBe(44);
    expect(usbFromCode('ArrowUp')).toBe(82);
    expect(usbFromCode('ShiftLeft')).toBe(225);
    expect(usbFromCode('ControlRight')).toBe(228);
    expect(usbFromCode('F1')).toBe(58);
    expect(usbFromCode('F12')).toBe(69);
    expect(usbFromCode('Numpad1')).toBe(89);
    expect(usbFromCode('Numpad9')).toBe(97);
    expect(usbFromCode('Numpad0')).toBe(98);
  });
  it('ignores keys the CPC has no use for', () => {
    expect(usbFromCode('MetaLeft')).toBeUndefined();
    expect(usbFromCode('LaunchMail')).toBeUndefined();
  });
});
