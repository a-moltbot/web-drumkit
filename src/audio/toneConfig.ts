import * as Tone from 'tone';

let configured = false;

export function configureLowLatencyTone() {
  if (configured) return;
  configured = true;

  const context = new Tone.Context({
    latencyHint: 'interactive',
    lookAhead: 0,
  });

  Tone.setContext(context, true);
}
