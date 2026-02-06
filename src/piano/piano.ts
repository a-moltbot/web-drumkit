import * as Tone from 'tone';

// Low-latency tuning: Tone's scheduling adds a default lookAhead that can feel laggy.
// Setting these lower is a commonly recommended workaround.
export function configureLowLatencyAudio() {
  // Tone.Transport may be unused but can still affect scheduling.
  Tone.getContext().lookAhead = 0;
  // Transport.lookAhead exists at runtime but may not be typed in some Tone versions.
  (Tone.Transport as unknown as { lookAhead: number }).lookAhead = 0;
}

export type PianoEngine = {
  start: () => Promise<void>;
  noteOn: (note: string, velocity?: number) => void;
  noteOff: (note: string) => void;
  dispose: () => void;
};

export function createPianoEngine(): PianoEngine {
  configureLowLatencyAudio();

  // A simple, bright electric-ish timbre without external samples.
  // PolySynth typing varies across Tone versions; keep it simple and set params after.
  const synth = new Tone.PolySynth(Tone.FMSynth);
  (synth as unknown as { maxPolyphony: number }).maxPolyphony = 10;
  // Leave headroom; mobile speakers clip easily.
  synth.volume.value = -16;

  // Voice params (electric-ish)
  synth.set({
    harmonicity: 2,
    modulationIndex: 10,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.08, sustain: 0.35, release: 0.25 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.002, decay: 0.18, sustain: 0.2, release: 0.18 },
  });

  // FX chain with safety limiter to avoid crackles / dropouts when polyphony stacks.
  const chorus = new Tone.Chorus(3, 2.5, 0.15).start();
  const filter = new Tone.Filter(8000, 'lowpass');
  const compressor = new Tone.Compressor({ threshold: -18, ratio: 6, attack: 0.003, release: 0.12 });
  const limiter = new Tone.Limiter(-1);

  synth.chain(chorus, filter, compressor, limiter, Tone.Destination);

  let started = false;

  return {
    async start() {
      if (started) return;
      await Tone.start();
      started = true;
    },
    noteOn(note: string, velocity = 0.9) {
      const t = Tone.now();
      synth.triggerAttack(note, t, velocity);
    },
    noteOff(note: string) {
      const t = Tone.now();
      synth.triggerRelease(note, t);
    },
    dispose() {
      synth.dispose();
      chorus.dispose();
      filter.dispose();
      compressor.dispose();
      limiter.dispose();
    },
  };
}
