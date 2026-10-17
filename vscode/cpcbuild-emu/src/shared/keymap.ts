/** KeyboardEvent.code -> USB HID scancode (what CPCEC's key map, emu_key_usb, is indexed by). */
const t: Record<string, number> = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { t['Key' + c] = 4 + i; });
'1234567890'.split('').forEach((c, i) => { t['Digit' + c] = 30 + i; });
Object.assign(t, {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47,
  BracketRight: 48, Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55,
  Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77,
  PageDown: 78, ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
  NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85, NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88,
  NumpadDecimal: 99, IntlBackslash: 100,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, ControlRight: 228, ShiftRight: 229, AltRight: 230,
});
for (let i = 1; i <= 12; i++) t['F' + i] = 57 + i;
for (let i = 1; i <= 9; i++) t['Numpad' + i] = 88 + i;
t.Numpad0 = 98;

export const USB_BY_CODE: Readonly<Record<string, number>> = t;

/** The USB scancode of a key, or undefined when the CPC has no use for it. */
export function usbFromCode(code: string): number | undefined {
  return USB_BY_CODE[code];
}
