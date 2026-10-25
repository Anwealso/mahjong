import { create } from "zustand";
import type { Cue, SoundId } from "./cues";

/** Recorded clips in `public/sounds/` (credits in CREDITS.md there). Several files = pick one at random. */
const FILES: Partial<Record<SoundId, string[]>> = {
  deal: ["deal"],
  discard: ["discard-1", "discard-2", "discard-3"],
  discardOther: ["discard-1", "discard-2", "discard-3"],
  draw: ["draw"],
  set: ["set"],
  kong: ["kong"],
  gong: ["gong"],
  cheer: ["cheer"],
};

/** Per-sound loudness, relative to the volume slider. */
const GAIN: Record<SoundId, number> = {
  deal: 0.8,
  discard: 0.9,
  discardOther: 0.55,
  draw: 0.45,
  yourTurn: 0.35,
  claimPing: 0.4,
  set: 0.9,
  kong: 1,
  win: 0.35,
  winBig: 0.45,
  drawHand: 0.5,
  gong: 0.9,
  cheer: 0.6,
  hostPrompt: 0.3,
};

// ---- settings ----------------------------------------------------------------------------------------

const SETTINGS_KEY = "mahjong.sound";

interface SoundSettings {
  volume: number;
  muted: boolean;
  setVolume(volume: number): void;
  toggleMute(): void;
}

function loadSettings(): { volume: number; muted: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as { volume?: number; muted?: boolean } | null;
    return { volume: saved?.volume ?? 0.6, muted: saved?.muted ?? false };
  } catch {
    return { volume: 0.6, muted: false };
  }
}

export const useSoundSettings = create<SoundSettings>()((set, get) => {
  const save = () => {
    const { volume, muted } = get();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ volume, muted }));
    applyVolume();
  };
  return {
    ...loadSettings(),
    setVolume(volume) {
      set({ volume, muted: false });
      save();
    },
    toggleMute() {
      set((s) => ({ muted: !s.muted }));
      save();
    },
  };
});

// ---- playback ----------------------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
/** When each sound was last scheduled, so the same sound isn't doubled (e.g. React StrictMode effects). */
const lastAt = new Map<SoundId, number>();

function applyVolume() {
  const { volume, muted } = useSoundSettings.getState();
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
}

/**
 * Browsers only allow audio after a user gesture, so create (or resume) the context on the first click or
 * key press, then load the clips.
 */
export function unlockAudio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
    const names = new Set(Object.values(FILES).flat());
    for (const name of names) void load(ctx, name);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

async function load(audio: AudioContext, name: string) {
  try {
    const response = await fetch(`/sounds/${name}.m4a`);
    buffers.set(name, await audio.decodeAudioData(await response.arrayBuffer()));
  } catch {
    // A missing clip just stays silent.
  }
}

export function play(sound: SoundId, delayMs = 0) {
  if (!ctx || !master || useSoundSettings.getState().muted) return;
  const at = ctx.currentTime + delayMs / 1000;
  if (Math.abs(at - (lastAt.get(sound) ?? -1)) < 0.05) return;
  lastAt.set(sound, at);
  const out = ctx.createGain();
  out.gain.value = GAIN[sound];
  out.connect(master);

  const files = FILES[sound];
  if (files) {
    const buffer = buffers.get(files[Math.floor(Math.random() * files.length)]!);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // A little pitch variation so repeated clacks don't sound mechanical.
    source.playbackRate.value = sound === "discard" || sound === "discardOther" ? 0.94 + Math.random() * 0.12 : 1;
    source.connect(out);
    source.start(at);
    return;
  }
  SYNTHS[sound]?.(ctx, out, at);
}

export function playCues(cues: Cue[]) {
  for (const cue of cues) play(cue.sound, cue.delay);
}

// ---- synthesised sounds ------------------------------------------------------------------------------

type Synth = (audio: AudioContext, out: AudioNode, at: number) => void;

/** One soft note: a quick attack, then an exponential decay. */
function note(audio: AudioContext, out: AudioNode, at: number, freq: number, length: number, type: OscillatorType = "sine", level = 1) {
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(level, at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

// Notes of the major pentatonic scale on C, in Hz.
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5;

const SYNTHS: Partial<Record<SoundId, Synth>> = {
  yourTurn: (a, out, t) => {
    note(a, out, t, E5, 0.35, "sine");
    note(a, out, t + 0.12, A5, 0.5, "sine");
  },
  claimPing: (a, out, t) => {
    note(a, out, t, E6, 0.18, "triangle");
    note(a, out, t + 0.08, E6 * 1.5, 0.25, "triangle", 0.7);
  },
  hostPrompt: (a, out, t) => {
    note(a, out, t, A5, 0.3, "sine");
    note(a, out, t + 0.15, E5, 0.45, "sine");
  },
  win: (a, out, t) => {
    [C5, D5, E5, G5, A5].forEach((f, i) => note(a, out, t + i * 0.08, f, 0.45, "triangle"));
    for (const f of [C5, E5, G5]) note(a, out, t + 0.45, f, 0.9, "triangle", 0.6);
  },
  winBig: (a, out, t) => {
    [C5, D5, E5, G5, A5, C6, D5 * 2, E6].forEach((f, i) => note(a, out, t + i * 0.07, f, 0.5, "triangle"));
    for (const f of [C5, E5, G5, C6]) note(a, out, t + 0.6, f, 1.6, "triangle", 0.6);
    for (const f of [C5 / 2, G5 / 2]) note(a, out, t + 0.6, f, 1.6, "sine", 0.8);
  },
  drawHand: (a, out, t) => {
    // A low thud, then a falling tone.
    const osc = a.createOscillator();
    const env = a.createGain();
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(env).connect(out);
    osc.start(t);
    osc.stop(t + 0.45);
    [G5 / 2, E5 / 2, D5 / 2, C5 / 2].forEach((f, i) => note(a, out, t + 0.15 + i * 0.14, f, 0.4, "sine", 0.6));
  },
};
