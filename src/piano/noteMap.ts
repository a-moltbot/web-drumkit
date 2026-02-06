export type SolfegeDegree = {
  solfege: string;
  note: string;
};

export const SOLFEGE: SolfegeDegree[] = [
  { solfege: 'Do', note: 'C' },
  { solfege: 'Re', note: 'D' },
  { solfege: 'Mi', note: 'E' },
  { solfege: 'Fa', note: 'F' },
  { solfege: 'So', note: 'G' },
  { solfege: 'La', note: 'A' },
  { solfege: 'Ti', note: 'B' },
];

export const KEY_LAYOUT: Record<'high' | 'mid' | 'low', string[]> = {
  high: ['q', 'w', 'e', 'u', 'i', 'o', 'p'],
  mid: ['a', 's', 'd', 'j', 'k', 'l', ';'],
  low: ['z', 'x', 'c', 'm', ',', '.', '/'],
};

const NOTE_TO_SEMITONE: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

const SEMITONE_TO_NOTE: string[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function parseNoteName(note: string): { pitch: string; octave: number } {
  const m = /^([A-G](?:#|b)?)(-?\d+)$/.exec(note);
  if (!m) return { pitch: 'C', octave: 4 };
  return { pitch: m[1], octave: parseInt(m[2], 10) };
}

export function transposeNoteName(note: string, semitones: number): string {
  const { pitch, octave } = parseNoteName(note);
  const base = NOTE_TO_SEMITONE[pitch] ?? 0;
  const total = base + semitones;

  // normalize to octave changes
  let o = octave;
  let s = total;
  while (s < 0) {
    s += 12;
    o -= 1;
  }
  while (s >= 12) {
    s -= 12;
    o += 1;
  }
  return `${SEMITONE_TO_NOTE[s]}${o}`;
}

export function formatKeyName(semitonesFromC: number): string {
  // Show the transposed tonic name.
  const s = ((semitonesFromC % 12) + 12) % 12;
  return SEMITONE_TO_NOTE[s];
}
