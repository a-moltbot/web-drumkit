import * as Tone from 'tone';
import { ensureAudioStarted } from './sampler';

type Subscriber = (beatIndex: number, barIndex: number) => void;

let initialized = false;
let sub: Subscriber | null = null;
let beatsPerBar = 4;
let bpm = 100;
let isRunning = false;
let currentBeat = 0;
let currentBar = 0;
// Accent per beat: true = hard beat
let accents: boolean[] = new Array(beatsPerBar).fill(false);
accents[0] = true;
// Volume per beat, 0..1
let volumes: number[] = new Array(beatsPerBar).fill(1);

let loop: Tone.Loop | null = null;
let clickHigh: Tone.MembraneSynth | null = null;
let clickLow: Tone.MembraneSynth | null = null;
let out: Tone.Gain | null = null;

function init() {
  if (initialized) return;
  out = new Tone.Gain(0.9).toDestination();
  clickHigh = new Tone.MembraneSynth({ octaves: 2, pitchDecay: 0.005, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(out);
  clickLow = new Tone.MembraneSynth({ octaves: 2, pitchDecay: 0.008, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } }).connect(out);
  Tone.Transport.bpm.value = bpm;
  Tone.Transport.timeSignature = beatsPerBar;
  loop = new Tone.Loop(time => {
    const beatInBar = currentBeat % beatsPerBar;
    // Play hard vs normal beat based on per-beat accent
    const vol = Math.max(0, Math.min(1, volumes[beatInBar] ?? 1));
    if (accents[beatInBar]) {
      clickHigh!.triggerAttackRelease(1200, '16n', time, 0.9 * vol);
    } else {
      clickLow!.triggerAttackRelease(800, '16n', time, 0.6 * vol);
    }
    // Bar counting still anchors on beat 0
    if (beatInBar === 0) currentBar++;
    sub?.(beatInBar, currentBar);
    currentBeat++;
  }, '4n');
  initialized = true;
}

export async function start() {
  try {
    const ready = await ensureAudioStarted();
    if (!ready) return;
  } catch {}
  init();
  currentBeat = 0;
  currentBar = 0;
  loop!.start(0);
  Tone.Transport.start();
  isRunning = true;
}

export function stop() {
  if (!initialized) return;
  loop!.stop();
  Tone.Transport.stop();
  isRunning = false;
}

export async function toggle() {
  if (isRunning) stop(); else await start();
}

export function setBpm(next: number) {
  bpm = Math.max(30, Math.min(300, Math.round(next)));
  Tone.Transport.bpm.rampTo(bpm, 0.05);
}

export function setBeatsPerBar(next: number) {
  beatsPerBar = Math.max(1, Math.min(12, Math.floor(next)));
  Tone.Transport.timeSignature = beatsPerBar;
// Resize accents, preserving existing values
  const newAccents = new Array(beatsPerBar).fill(false);
  for (let i = 0; i < Math.min(accents.length, beatsPerBar); i++) newAccents[i] = accents[i];
  accents = newAccents;
  // Resize volumes, preserving, default to 1
  const newVolumes = new Array(beatsPerBar).fill(1);
  for (let i = 0; i < Math.min(volumes.length, beatsPerBar); i++) newVolumes[i] = volumes[i];
  volumes = newVolumes;
}

export function onTick(fn: Subscriber | null) {
  sub = fn;
}

export function getState() {
  return { bpm, beatsPerBar, isRunning, accents: [...accents], volumes: [...volumes] };
}

export function setAccentForBeat(beatIndex: number, v: boolean) {
  const idx = Math.max(0, Math.min(beatsPerBar - 1, Math.floor(beatIndex)));
  accents[idx] = !!v;
}

export function toggleAccentForBeat(beatIndex: number) {
  const idx = Math.max(0, Math.min(beatsPerBar - 1, Math.floor(beatIndex)));
  accents[idx] = !accents[idx];
}

export function setAccents(values: boolean[]) {
  const next = new Array(beatsPerBar).fill(false);
  for (let i = 0; i < Math.min(values.length, beatsPerBar); i++) next[i] = !!values[i];
  accents = next;
}

export function setVolumeForBeat(beatIndex: number, value: number) {
  const idx = Math.max(0, Math.min(beatsPerBar - 1, Math.floor(beatIndex)));
  const v = Math.max(0, Math.min(1, Number(value)));
  volumes[idx] = v;
}

export function setVolumes(values: number[]) {
  const next = new Array(beatsPerBar).fill(1);
  for (let i = 0; i < Math.min(values.length, beatsPerBar); i++) next[i] = Math.max(0, Math.min(1, Number(values[i])));
  volumes = next;
}
