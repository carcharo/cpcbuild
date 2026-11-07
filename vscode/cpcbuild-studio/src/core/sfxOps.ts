/**
 * sfxOps.ts -- the edit operations of the sound-effects editor, applied to a SfxDoc.
 *
 * Pure TypeScript. The webview sends these; the host applies them (sfxEditor.ts) as one undoable
 * edit each. Every op returns a new document (the old one is untouched, so undo is a swap) or an
 * error message. A hand edit of frames removes the effect's preset ("drawn"); changing the preset
 * regenerates the frames.
 */
import {
  MAX_EFFECTS,
  MAX_FRAMES,
  MAX_PITCH,
  MIN_PITCH,
  PRESET_KINDS,
  PresetKind,
  PresetParams,
  SfxDoc,
  SfxEffect,
  SfxFrame,
  nameProblem,
  roundPitch,
  uniqueName,
} from './sfxDoc';
import { DEFAULT_PARAMS, presetEffect, PRESET_LABELS, clampParams, generate } from './sfxPresets';

export type SfxOp =
  /** Replace the frames from `start` with `frames` (a hand edit: the preset is removed). */
  | { op: 'setFrames'; effect: number; start: number; frames: SfxFrame[]; label?: string }
  /** Make the effect `length` frames long, repeating the last frame to grow (a hand edit). */
  | { op: 'resize'; effect: number; length: number }
  /** Insert a copy of frame `at` right after it. */
  | { op: 'insertFrame'; effect: number; at: number }
  | { op: 'deleteFrame'; effect: number; at: number }
  | { op: 'rename'; effect: number; name: string }
  /** Add an effect made from a preset (default parameters), after effect `after` (default: at the end). */
  | { op: 'addPreset'; kind: PresetKind; after?: number }
  /** Add a drawn effect: 10 frames of C-4 at full volume. */
  | { op: 'addBlank'; after?: number }
  /** Regenerate the frames from a preset kind and parameters (kept as the effect's preset). */
  | { op: 'setPreset'; effect: number; kind: PresetKind; params: PresetParams }
  | { op: 'duplicate'; effect: number }
  | { op: 'delete'; effect: number }
  | { op: 'move'; from: number; to: number };

export type SfxOutcome = { state: SfxDoc; label: string } | { error: string };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** `f` forced into the ranges of the format. */
export function cleanFrame(f: SfxFrame): SfxFrame {
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return {
    ...f,
    pitch: roundPitch(clamp(num(f.pitch, 60), MIN_PITCH, MAX_PITCH)),
    tone: !!f.tone,
    noise: !!f.noise,
    noisePeriod: Math.round(clamp(num(f.noisePeriod, 0), 0, 31)),
    volume: Math.round(clamp(num(f.volume, 0), 0, 15)),
  };
}

const sameFrame = (a: SfxFrame, b: SfxFrame): boolean => a.pitch === b.pitch && a.tone === b.tone && a.noise === b.noise && a.noisePeriod === b.noisePeriod && a.volume === b.volume;

/** The effect without its preset (a drawn effect) and with these frames. */
function drawn(e: SfxEffect, frames: SfxFrame[]): SfxEffect {
  const { preset: _preset, ...rest } = e;
  return { ...rest, frames };
}

function withEffects(doc: SfxDoc, effects: SfxEffect[]): SfxDoc {
  return { ...doc, effects };
}

function replaceAt(doc: SfxDoc, i: number, e: SfxEffect): SfxDoc {
  return withEffects(doc, doc.effects.map((x, k) => (k === i ? e : x)));
}

function insertEffect(doc: SfxDoc, after: number | undefined, e: SfxEffect): SfxDoc {
  const at = after === undefined ? doc.effects.length : clamp(after + 1, 0, doc.effects.length);
  return withEffects(doc, [...doc.effects.slice(0, at), e, ...doc.effects.slice(at)]);
}

const inRange = (n: unknown, len: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < len;

export function applyOp(doc: SfxDoc, op: SfxOp): SfxOutcome {
  const needEffect = (i: unknown): string | undefined => (inRange(i, doc.effects.length) ? undefined : `no effect ${String(i)}`);
  const full = (): string | undefined => (doc.effects.length >= MAX_EFFECTS ? `a bank has at most ${MAX_EFFECTS} effects` : undefined);
  switch (op.op) {
    case 'setFrames': {
      const bad = needEffect(op.effect);
      if (bad) return { error: bad };
      const e = doc.effects[op.effect];
      if (!Number.isInteger(op.start) || op.start < 0 || op.start + op.frames.length > e.frames.length) return { error: 'frames outside the effect' };
      const next = op.frames.map(cleanFrame);
      const frames = [...e.frames.slice(0, op.start), ...next, ...e.frames.slice(op.start + next.length)];
      if (frames.every((f, k) => sameFrame(f, e.frames[k]))) return { error: 'unchanged' };
      return { state: replaceAt(doc, op.effect, drawn(e, frames)), label: op.label ?? 'Draw frames' };
    }
    case 'resize': {
      const bad = needEffect(op.effect);
      if (bad) return { error: bad };
      const e = doc.effects[op.effect];
      const n = Math.round(op.length);
      if (!(n >= 1 && n <= MAX_FRAMES)) return { error: `an effect has 1-${MAX_FRAMES} frames` };
      if (n === e.frames.length) return { error: 'unchanged' };
      const frames = n < e.frames.length ? e.frames.slice(0, n) : [...e.frames, ...Array.from({ length: n - e.frames.length }, () => ({ ...e.frames[e.frames.length - 1] }))];
      return { state: replaceAt(doc, op.effect, drawn(e, frames)), label: 'Change length' };
    }
    case 'insertFrame': {
      const bad = needEffect(op.effect);
      if (bad) return { error: bad };
      const e = doc.effects[op.effect];
      if (!inRange(op.at, e.frames.length)) return { error: `no frame ${String(op.at)}` };
      if (e.frames.length >= MAX_FRAMES) return { error: `an effect has at most ${MAX_FRAMES} frames` };
      const frames = [...e.frames.slice(0, op.at + 1), { ...e.frames[op.at] }, ...e.frames.slice(op.at + 1)];
      return { state: replaceAt(doc, op.effect, drawn(e, frames)), label: 'Insert frame' };
    }
    case 'deleteFrame': {
      const bad = needEffect(op.effect);
      if (bad) return { error: bad };
      const e = doc.effects[op.effect];
      if (!inRange(op.at, e.frames.length)) return { error: `no frame ${String(op.at)}` };
      if (e.frames.length <= 1) return { error: 'an effect needs at least one frame' };
      return { state: replaceAt(doc, op.effect, drawn(e, e.frames.filter((_, k) => k !== op.at))), label: 'Delete frame' };
    }
    case 'rename': {
      const bad = needEffect(op.effect);
      if (bad) return { error: bad };
      const e = doc.effects[op.effect];
      if (op.name === e.name) return { error: 'unchanged' };
      const np = nameProblem(op.name);
      if (np) return { error: np };
      const clash = doc.effects.findIndex((x, k) => k !== op.effect && x.name.toLowerCase() === op.name.toLowerCase());
      if (clash >= 0) return { error: `name "${op.name}" is already used by effect ${clash + 1}` };
      return { state: replaceAt(doc, op.effect, { ...e, name: op.name }), label: 'Rename effect' };
    }
    case 'addPreset': {
      const f = full();
      if (f) return { error: f };
      if (!(PRESET_KINDS as readonly unknown[]).includes(op.kind)) return { error: `unknown preset ${String(op.kind)}` };
      const e = presetEffect(op.kind, uniqueName(doc, op.kind));
      return { state: insertEffect(doc, op.after, e), label: `Add ${PRESET_LABELS[op.kind]} effect` };
    }
    case 'addBlank': {
      const f = full();
      if (f) return { error: f };
      const frames = Array.from({ length: 10 }, (): SfxFrame => ({ pitch: 60, tone: true, noise: false, noisePeriod: 0, volume: 15 }));
      return { state: insertEffect(doc, op.after, { name: uniqueName(doc, 'effect'), frames }), label: 'Add blank effect' };
    }
    case 'setPreset': {
      const bad = needEffect(op.effect);
      if (bad) return { error: bad };
      if (!(PRESET_KINDS as readonly unknown[]).includes(op.kind)) return { error: `unknown preset ${String(op.kind)}` };
      const e = doc.effects[op.effect];
      const params = clampParams({ ...DEFAULT_PARAMS[op.kind], ...op.params });
      const frames = generate(op.kind, params);
      if (e.preset && e.preset.kind === op.kind && JSON.stringify(e.preset.params) === JSON.stringify(params)) return { error: 'unchanged' };
      return { state: replaceAt(doc, op.effect, { ...e, frames, preset: { kind: op.kind, params } }), label: `Preset ${PRESET_LABELS[op.kind]}` };
    }
    case 'duplicate': {
      const bad = needEffect(op.effect) ?? full();
      if (bad) return { error: bad };
      const e = doc.effects[op.effect];
      const copy: SfxEffect = { ...e, name: uniqueName(doc, e.name.replace(/\d+$/, '') || e.name), frames: e.frames.map((f) => ({ ...f })), ...(e.preset ? { preset: { kind: e.preset.kind, params: { ...e.preset.params } } } : {}) };
      return { state: insertEffect(doc, op.effect, copy), label: 'Duplicate effect' };
    }
    case 'delete': {
      const bad = needEffect(op.effect);
      if (bad) return { error: bad };
      if (doc.effects.length <= 1) return { error: 'a bank needs at least one effect' };
      return { state: withEffects(doc, doc.effects.filter((_, k) => k !== op.effect)), label: 'Delete effect' };
    }
    case 'move': {
      const bad = needEffect(op.from) ?? needEffect(op.to);
      if (bad) return { error: bad };
      if (op.from === op.to) return { error: 'unchanged' };
      const list = [...doc.effects];
      const [e] = list.splice(op.from, 1);
      list.splice(op.to, 0, e);
      return { state: withEffects(doc, list), label: 'Move effect' };
    }
    default:
      return { error: 'unknown operation' };
  }
}
