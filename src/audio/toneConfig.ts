import * as Tone from 'tone';

let configured = false;

export function configureLowLatencyTone() {
  if (configured) return;
  configured = true;
  const context = Tone.getContext();
  context.lookAhead = 0.03;
}
