import { useEffect, useMemo, useRef, useState } from 'react';
import { createPianoEngine } from '../piano/piano';
import { formatKeyName, KEY_LAYOUT, SOLFEGE, transposeNoteName } from '../piano/noteMap';
import ModeSwitch from '../components/ModeSwitch';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

type RowKind = 'high' | 'mid' | 'low';

type KeyDef = {
  row: RowKind;
  physical: string;
  solfege: string;
  baseNote: string; // e.g. C4
};

function buildKeyDefs(): KeyDef[] {
  const degrees = SOLFEGE; // 7

  const mkRow = (row: RowKind, octave: number) => {
    const physical = KEY_LAYOUT[row];
    return physical.map((k, i) => {
      const d = degrees[i];
      return {
        row,
        physical: k,
        solfege: d.solfege,
        baseNote: `${d.note}${octave}`,
      };
    });
  };

  // mid row is the reference (C4). high +1 octave, low -1 octave.
  return [...mkRow('high', 5), ...mkRow('mid', 4), ...mkRow('low', 3)];
}

export default function PianoPage() {
  // IMPORTANT: don't call createPianoEngine() during render.
  // React re-renders often (hover/pressed/help) and that would create + connect new audio graphs repeatedly.
  const engineRef = useRef<ReturnType<typeof createPianoEngine> | null>(null);
  if (!engineRef.current) {
    engineRef.current = createPianoEngine();
  }
  const keyDefs = useMemo(() => buildKeyDefs(), []);

  const [audioEnabled, setAudioEnabled] = useState(false);
  const [transpose, setTranspose] = useState(0); // semitones from C
  const [pressed, setPressed] = useState<Record<string, boolean>>({});
  const activeNotesRef = useRef<Record<string, string>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const transposeName = formatKeyName(transpose);
  const noteFor = (kd: KeyDef) => transposeNoteName(kd.baseNote, transpose);

  const startInFlight = useRef<Promise<void> | null>(null);

  const ensureAudioStarted = async () => {
    if (audioEnabled) return true;
    try {
      if (!startInFlight.current) {
        startInFlight.current = engineRef.current!.start();
      }
      await startInFlight.current;
      setAudioEnabled(true);
      return true;
    } catch {
      return false;
    } finally {
      startInFlight.current = null;
    }
  };

  const press = async (kd: KeyDef) => {
    const phys = kd.physical;
    if (pressed[phys]) return;

    const ok = await ensureAudioStarted();
    if (!ok) return;

    const note = noteFor(kd);
    activeNotesRef.current[phys] = note;
    engineRef.current!.noteOn(note);
    setPressed((p) => ({ ...p, [phys]: true }));
  };

  const release = (kd: KeyDef) => {
    const phys = kd.physical;
    if (!pressed[phys]) return;

    const note = activeNotesRef.current[phys] ?? noteFor(kd);
    delete activeNotesRef.current[phys];
    engineRef.current!.noteOff(note);
    setPressed((p) => ({ ...p, [phys]: false }));
  };

  const releaseAll = () => {
    const active = activeNotesRef.current;
    for (const phys of Object.keys(active)) {
      engineRef.current!.noteOff(active[phys]);
      delete active[phys];
    }
    setPressed({});
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        releaseAll();
        setTranspose((t) => t - 1);
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        releaseAll();
        setTranspose((t) => t + 1);
        return;
      }

      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const kd = keyDefs.find((d) => d.physical === k);
      if (!kd) return;
      void press(kd);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const kd = keyDefs.find((d) => d.physical === k);
      if (!kd) return;
      release(kd);
    };

    const onBlur = () => releaseAll();
    const onVis = () => {
      if (document.hidden) releaseAll();
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [keyDefs, pressed, audioEnabled, transpose]);

  useEffect(() => {
    return () => engineRef.current?.dispose();
  }, []);

  const row = (rowKind: RowKind) => {
    const keys = keyDefs.filter((k) => k.row === rowKind);
    return (
      <div className="grid grid-cols-7 gap-2">
        {keys.map((k) => {
          const isDown = !!pressed[k.physical];
          const showDetails = helpOpen || hovered === k.physical;
          return (
            <button
              key={`${rowKind}-${k.physical}`}
              className={
                'relative select-none rounded-2xl border border-border bg-card/70 px-3 py-6 text-left shadow-sm backdrop-blur active:scale-[0.99] ' +
                (isDown ? 'ring-2 ring-accent/60' : rowKind === 'mid' ? 'hover:bg-card/90' : 'bg-card/55 hover:bg-card/80')
              }
              onPointerEnter={() => setHovered(k.physical)}
              onPointerLeave={() => {
                setHovered((h) => (h === k.physical ? null : h));
                release(k);
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                void press(k);
              }}
              onPointerUp={() => release(k)}
              onPointerCancel={() => release(k)}
            >
              <div className="text-lg font-semibold">{k.solfege}</div>
              {showDetails ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {k.physical.toUpperCase()} • {noteFor(k)}
                </div>
              ) : (
                <div className="mt-1 text-xs opacity-40">&nbsp;</div>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-24 left-[-6%] h-72 w-72 rounded-full blur-3xl opacity-60"
          style={{
            background: 'radial-gradient(circle at center, hsl(var(--primary) / 0.30), transparent 70%)',
          }}
        />
        <div
          className="absolute -bottom-28 right-[-8%] h-80 w-80 rounded-full blur-3xl opacity-60"
          style={{
            background: 'radial-gradient(circle at center, hsl(var(--accent) / 0.30), transparent 70%)',
          }}
        />
      </div>

      <div className="relative mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">Practice lab</p>
            <h1 className="font-display text-5xl leading-none">Web Piano</h1>
            <p className="max-w-xl text-sm text-muted-foreground">Phone-first solfege keyboard • low-latency Tone.js</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">Key: {transposeName}</Badge>
            <ModeSwitch />
          </div>
        </header>

        <Card className="bg-card/85 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-2xl">Controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>Arrow keys transpose (default C).</div>
              <button
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm hover:bg-card/90"
                onClick={() => setHelpOpen((v) => !v)}
              >
                {helpOpen ? 'Hide help' : 'Help'}
              </button>
            </div>

            {helpOpen ? (
              <div className="space-y-1 text-xs">
                <div>Keybinds:</div>
                <div>+1 octave: Q W E U I O P</div>
                <div>C4 row: A S D J K L ;</div>
                <div>-1 octave: Z X C M , . /</div>
                <div className="pt-1">Tip: hover keys to see note labels.</div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm hover:bg-card/90"
                onClick={() => {
                  releaseAll();
                  setTranspose(0);
                }}
              >
                Reset to C
              </button>
              <button
                className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm hover:bg-card/90"
                onClick={() => releaseAll()}
              >
                Panic (stop notes)
              </button>
              <button
                className={
                  'rounded-xl border px-3 py-2 text-sm shadow-sm ' +
                  (audioEnabled
                    ? 'border-border bg-secondary text-secondary-foreground'
                    : 'border-border bg-primary text-primary-foreground hover:brightness-105')
                }
                onClick={async () => {
                  const ok = await ensureAudioStarted();
                  if (!ok) return;
                }}
              >
                {audioEnabled ? 'Audio enabled' : 'Enable audio'}
              </button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {row('high')}
          {row('mid')}
          {row('low')}
        </div>
      </div>
    </div>
  );
}
