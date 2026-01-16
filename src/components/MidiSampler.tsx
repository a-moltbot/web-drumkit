import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MidiDevicePicker from './MidiDevicePicker';
import { initMidiCcListenerForInput, initMidiListenerForInput } from '../midi/midi';
import { ensureAudioStarted, getDrumSampler, listDrumPads, triggerMidi, isUsingFallback, DrumPad, triggerPad, midiNoteToPad, MidiCC, setHiHatOpenByCC4 } from '../audio/sampler';
import { useKeyboardPads, KeyMap } from '../hooks/useKeyboardPads';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

type PadBinding = { keys: string[]; midis: number[]; ccs: number[] };
type PadBindings = Record<number, PadBinding>; // target midi -> bindings

function midiNumberToName(n: number) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(n / 12) - 1;
  const name = names[n % 12];
  return `${name}${octave}`;
}

function ccNumberToName(cc: number) {
  switch (cc) {
    case MidiCC.FootController:
      return 'Foot Ctrl (CC 4)';
    case MidiCC.SustainPedal:
      return 'Sustain (CC 64)';
    default:
      return `CC ${cc}`;
  }
}

function normalizeBinding(binding?: Partial<PadBinding> | null): PadBinding {
  return {
    keys: binding?.keys ?? [],
    midis: binding?.midis ?? [],
    ccs: binding?.ccs ?? [],
  };
}

const CC_TRIGGER_THRESHOLD = 64;

export default function MidiSampler() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ note?: number; velocity?: number }>({});
  const [flashPad, setFlashPad] = useState<DrumPad | null>(null);
  const [engine, setEngine] = useState<'samples' | 'synth'>(() => (isUsingFallback() ? 'synth' : 'samples'));
  const [loading, setLoading] = useState<boolean>(false);
  const [audioReady, setAudioReady] = useState<boolean>(false);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [modalForMidi, setModalForMidi] = useState<number | null>(null); // target pad midi
  const [listenKeyForMidi, setListenKeyForMidi] = useState<number | null>(null);
  const [listenMidiForMidi, setListenMidiForMidi] = useState<number | null>(null); // target pad midi we capture for
  const [listenCcForMidi, setListenCcForMidi] = useState<number | null>(null);
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  const [conflictMidi, setConflictMidi] = useState<{ note: number; ownerLabel: string } | null>(null);
  const [conflictCc, setConflictCc] = useState<{ cc: number; ownerLabel: string } | null>(null);
  // no crash/snare variant toggles for now

  // Refs to always read latest data inside MIDI handler without stale closures
  const bindingsRef = useRef<PadBindings>({});
  const defaultMidiSetRef = useRef<Set<number>>(new Set());
  const audioReadyRef = useRef<boolean>(false);
  const ccDownRef = useRef<Record<number, boolean>>({});

  useEffect(() => {
    audioReadyRef.current = audioReady;
  }, [audioReady]);

  const prepareAudio = useCallback(async () => {
    if (audioReadyRef.current || loading) return audioReadyRef.current;
    setLoading(true);
    setError(null);
    try {
      const ready = await ensureAudioStarted();
      if (!ready) throw new Error('Audio is locked by the browser. Click Enable audio.');
      await getDrumSampler();
      setEngine(isUsingFallback() ? 'synth' : 'samples');
      setAudioReady(true);
      audioReadyRef.current = true;
      return true;
    } catch (e: any) {
      setError(e?.message || String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    let disposed = false;
    let disposer: { dispose: () => void } | null = null;
    let ccDisposer: { dispose: () => void } | null = null;
    ccDownRef.current = {};
    if (!selectedId) return () => {};
    (async () => {
      try {
        const d = await initMidiListenerForInput(selectedId, async (note, vel) => {
          if (disposed) return;
          setLast({ note, velocity: vel });
          // If we are capturing a MIDI note for binding, record and skip normal triggering
          if (listenMidiForMidi != null && vel > 0) {
            // Prevent duplicate MIDI mapping used by another sound
            let ownerLabel: string | null = null;
            for (const [m, b] of Object.entries(bindingsRef.current)) {
              const target = Number(m);
              if (target !== listenMidiForMidi && (b?.midis || []).includes(note)) {
                ownerLabel = midiToLabel[target] || 'another sound';
                break;
              }
            }
            // Prevent binding a GM default note that belongs to another sound
            const isDefaultMidi = defaultMidiSetRef.current.has(note) && note !== listenMidiForMidi;
            if (isDefaultMidi && !ownerLabel) {
              ownerLabel = midiToLabel[note] || 'another sound';
            }
            if (ownerLabel) {
              setConflictMidi({ note, ownerLabel });
              setListenMidiForMidi(null);
              return;
            }
            setBindings(prev => {
              const t = listenMidiForMidi;
              const cur = normalizeBinding(prev[t]);
              // ignore if trying to add its own default midi
              if (note === t) return prev;
              if (!cur.midis.includes(note)) {
                const next = { ...prev, [t]: { ...cur, midis: [...cur.midis, note] } } as PadBindings;
                try { localStorage.setItem(BINDING_KEY, JSON.stringify(next)); } catch {}
                return next;
              }
              return prev;
            });
            setListenMidiForMidi(null);
            return;
          }
          const getResolvedIncomingMidi = (incoming: number) => {
            // Never override GM default mappings
            if (defaultMidiSetRef.current.has(incoming)) return incoming;
            for (const [targetStr, b] of Object.entries(bindingsRef.current)) {
              if (b?.midis?.includes(incoming)) return Number(targetStr);
            }
            return incoming;
          };
          const resolved = getResolvedIncomingMidi(note);
          if (vel > 0 && resolved != null) {
            const pad = midiNoteToPad(resolved);
            if (pad) {
              setFlashPad(pad);
              setTimeout(() => setFlashPad(prev => (prev === pad ? null : prev)), 120);
            }
          }
          if (!audioReadyRef.current) return;
          if (vel > 0) await triggerMidi(resolved ?? note, vel);
        });
        disposer = d;
        ccDisposer = await initMidiCcListenerForInput(selectedId, (cc, val) => {
          if (disposed) return;
          if (cc === MidiCC.FootController) setHiHatOpenByCC4(val);
          if (listenCcForMidi != null && val > 0) {
            let ownerLabel: string | null = null;
            for (const [m, b] of Object.entries(bindingsRef.current)) {
              const target = Number(m);
              if (target !== listenCcForMidi && (b?.ccs || []).includes(cc)) {
                ownerLabel = midiToLabel[target] || 'another sound';
                break;
              }
            }
            if (ownerLabel) {
              setConflictCc({ cc, ownerLabel });
              setListenCcForMidi(null);
              return;
            }
            setBindings(prev => {
              const t = listenCcForMidi;
              const cur = normalizeBinding(prev[t]);
              if (!cur.ccs.includes(cc)) {
                const next = { ...prev, [t]: { ...cur, ccs: [...cur.ccs, cc] } } as PadBindings;
                try { localStorage.setItem(BINDING_KEY, JSON.stringify(next)); } catch {}
                return next;
              }
              return prev;
            });
            setListenCcForMidi(null);
            return;
          }
          const getResolvedIncomingCc = (incoming: number) => {
            for (const [targetStr, b] of Object.entries(bindingsRef.current)) {
              if (b?.ccs?.includes(incoming)) return Number(targetStr);
            }
            return null;
          };
          const resolved = getResolvedIncomingCc(cc);
          const isDown = val >= CC_TRIGGER_THRESHOLD;
          const wasDown = ccDownRef.current[cc] || false;
          ccDownRef.current[cc] = isDown;
          if (!isDown || wasDown || resolved == null) return;
          const pad = midiNoteToPad(resolved);
          if (pad) {
            setFlashPad(pad);
            setTimeout(() => setFlashPad(prev => (prev === pad ? null : prev)), 120);
          }
          if (!audioReadyRef.current) return;
          void triggerMidi(resolved, Math.max(1, Math.min(127, val)));
        });
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    })();
    return () => {
      disposed = true;
      try {
        disposer?.dispose();
      } catch {}
      try {
        ccDisposer?.dispose();
      } catch {}
    };
  }, [selectedId, listenMidiForMidi, listenCcForMidi]);

  const allPads = useMemo(() => listDrumPads(), []);
  const order: DrumPad[] = [
    DrumPad.HiHatClosed, DrumPad.HiHatPedal, DrumPad.HiHatOpen, DrumPad.Crash, DrumPad.Ride, DrumPad.Stick,
    DrumPad.Kick, DrumPad.Snare, DrumPad.TomHigh, DrumPad.TomMid, DrumPad.TomFloor,
  ];
  const pads = useMemo(() => {
    const map = new Map(allPads.map(p => [p.pad, p] as const));
    return order.map(p => map.get(p)).filter(Boolean) as typeof allPads;
  }, [allPads]);
  const padsByPad = useMemo(() => new Map(allPads.map(p => [p.pad, p])), [allPads]);
  const midiToLabel = useMemo(() => Object.fromEntries(allPads.map(p => [p.midi, p.label] as const)), [allPads]);

  const handlePad = useCallback(async (pad: DrumPad) => {
    if (loading) return; // ignore interaction while loading
    if (editMode) {
      const midi = padsByPad.get(pad)?.midi;
      if (midi != null) {
        setModalForMidi(midi);
        setConflictKey(null);
        setConflictMidi(null);
        setConflictCc(null);
      }
      return;
    }
    const ready = await prepareAudio();
    if (!ready) return;
    setFlashPad(pad);
    setTimeout(() => setFlashPad(prev => (prev === pad ? null : prev)), 120);
    await triggerPad(pad, 100);
  }, [loading, editMode, padsByPad, prepareAudio]);

  // Bindings (keys + extra MIDI notes) with persistence
  const BINDING_KEY = 'drum_bindings_v1';
  const LEGACY_KEYMAP_KEY = 'drum_keymap_v1';
  const [bindings, setBindings] = useState<PadBindings>(() => {
    try {
      const raw = localStorage.getItem(BINDING_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<number, Partial<PadBinding>>;
        return Object.fromEntries(
          Object.entries(parsed).map(([m, b]) => [Number(m), normalizeBinding(b)])
        ) as PadBindings;
      }
    } catch {}
    // migrate legacy midiToKeys if present
    let migrated: PadBindings | null = null;
    try {
      const legacy = localStorage.getItem(LEGACY_KEYMAP_KEY);
      if (legacy) {
        const parsed: Record<number, string[]> = JSON.parse(legacy);
        migrated = Object.fromEntries(
          Object.entries(parsed).map(([m, keys]) => [Number(m), { keys: keys || [], midis: [], ccs: [] }])
        ) as PadBindings;
      }
    } catch {}
    if (migrated) return migrated;
    // Start with no key bindings by default
    return {} as PadBindings;
  });

  useEffect(() => {
    defaultMidiSetRef.current = new Set(allPads.map(p => p.midi));
  }, [allPads]);

  const keyMap: KeyMap = useMemo(() => {
    const entries: [string, { midi: number } ][] = [];
    Object.entries(bindings).forEach(([midi, b]) => {
      (b?.keys || []).forEach((k) => entries.push([k, { midi: Number(midi) }]));
    });
    return Object.fromEntries(entries);
  }, [bindings]);

  const persistBindings = (next: PadBindings) => {
    setBindings(next);
    try { localStorage.setItem(BINDING_KEY, JSON.stringify(next)); } catch {}
    bindingsRef.current = next;
  };

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useKeyboardPads(keyMap, {
    onTrigger: async (midi, velocity = 100) => {
      try {
        if (loading) return;
        const ready = await prepareAudio();
        if (!ready) return;
        const pad = midiNoteToPad(midi);
        if (pad) {
          setFlashPad(pad);
          setTimeout(() => setFlashPad(prev => (prev === pad ? null : prev)), 120);
        }
        await triggerMidi(midi, velocity);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    },
  });

  return (
    <>
      <Card className="relative overflow-hidden bg-card/85 backdrop-blur">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="font-display text-3xl">MIDI Sampler</CardTitle>
              <CardDescription>Connect a controller or tap the pads below.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {loading && <Badge variant="secondary">Loading kit…</Badge>}
              {!audioReady && !loading && <Badge variant="outline">Audio locked</Badge>}
              <Badge variant={engine === 'samples' ? 'accent' : 'outline'}>
                {engine === 'samples' ? 'Samples engine' : 'Synth fallback'}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <MidiDevicePicker
            onSelect={(id) => {
              setSelectedId(id || null);
            }}
          />

          <div className="rounded-2xl border border-border/70 bg-muted/40 p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Pad bank</p>
                <p className="text-xs text-muted-foreground">
                  {audioReady
                    ? 'Click, touch, or hit mapped keys.'
                    : 'Click Enable audio or tap a pad to unlock sound.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!audioReady && (
                  <Button variant="accent" size="sm" onClick={prepareAudio} disabled={loading}>
                    Enable audio
                  </Button>
                )}
                {editMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const ok = window.confirm('Reset all custom key and MIDI bindings?');
                      if (!ok) return;
                      setListenKeyForMidi(null);
                      setListenMidiForMidi(null);
                      setListenCcForMidi(null);
                      setConflictKey(null);
                      setConflictMidi(null);
                      setConflictCc(null);
                      persistBindings({});
                    }}
                  >
                    Reset bindings
                  </Button>
                )}
                <Button
                  onClick={() => setEditMode(v => !v)}
                  variant={editMode ? 'accent' : 'secondary'}
                  size="sm"
                >
                  {editMode ? 'Editing' : 'Edit mappings'}
                </Button>
              </div>
            </div>

            <div className="relative">
              {loading && (
                <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-background/70 backdrop-blur-sm">
                  <div className="text-sm text-muted-foreground">Loading samples…</div>
                </div>
              )}
              <div className={'grid grid-cols-3 sm:grid-cols-6 gap-2 ' + (loading ? 'pointer-events-none opacity-50' : '')}>
                {pads.map(p => (
                  <button
                    key={p.pad}
                    disabled={loading}
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      handlePad(p.pad);
                    }}
                    onClick={(e) => {
                      if (e.detail === 0) handlePad(p.pad);
                    }}
                    className={
                      'relative px-3 py-4 rounded-xl border text-foreground active:translate-y-[1px] transition shadow-sm ' +
                      (flashPad === p.pad
                        ? 'border-accent bg-accent/15 shadow-[0_0_0_2px_hsl(var(--accent)/0.25)]'
                        : editMode
                          ? 'border-primary/70 bg-primary/10 hover:border-primary'
                          : 'border-border bg-background/80 hover:border-accent/60 hover:bg-accent/10')
                    }
                  >
                    <div className="text-sm font-semibold sm:text-base">{p.label}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}
        </CardContent>
      </Card>

      {modalForMidi != null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border/80 bg-popover p-4 text-popover-foreground shadow-lg">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="text-sm text-muted-foreground">Binding for</div>
                <div className="text-lg font-semibold">{pads.find(p => p.midi === modalForMidi)?.label}</div>
              </div>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => { setModalForMidi(null); setListenKeyForMidi(null); setListenMidiForMidi(null); setListenCcForMidi(null); setConflictKey(null); setConflictMidi(null); setConflictCc(null); }}
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] sm:text-base font-semibold">Keys</div>
                  <button
                    aria-label="Add key binding"
                    className={
                      'inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full border ' +
                      (listenKeyForMidi === modalForMidi
                        ? 'bg-primary/90 border-primary text-primary-foreground'
                        : 'bg-transparent border-accent/50 text-accent hover:bg-accent/10')
                    }
                    onClick={() => {
                      setListenMidiForMidi(null);
                      setListenCcForMidi(null);
                      setListenKeyForMidi(modalForMidi);
                      setConflictKey(null);
                      setConflictMidi(null);
                      setConflictCc(null);
                      const once = (e: KeyboardEvent) => {
                        const k = e.key.toLowerCase();
                        e.preventDefault();
                        const conflict = Object.entries(bindings).some(([m, b]) => Number(m) !== modalForMidi && (b?.keys || []).includes(k));
                        if (conflict) {
                          setConflictKey(k);
                          setListenKeyForMidi(null);
                          return;
                        }
                        const cur = normalizeBinding(bindings[modalForMidi]);
                        if (!cur.keys.includes(k)) {
                          const next = { ...bindings, [modalForMidi]: { ...cur, keys: [...cur.keys, k] } } as PadBindings;
                          persistBindings(next);
                        }
                        setListenKeyForMidi(null);
                      };
                      window.addEventListener('keydown', once, { once: true });
                    }}
                  >
                    <span className="text-lg leading-none">+</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 content-start items-center min-h-[72px]">
                  {(bindings[modalForMidi]?.keys || []).map(k => (
                    <span key={k} className="whitespace-nowrap text-sm md:text-base bg-accent/10 border border-accent/50 text-foreground rounded-full h-8 px-3 inline-flex items-center gap-2">
                      {k.toUpperCase()}
                      <button
                        aria-label="Remove"
                        className="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full border border-accent/60 text-accent hover:bg-accent/20"
                        onClick={() => {
                          const cur = normalizeBinding(bindings[modalForMidi]);
                          const next = { ...bindings, [modalForMidi]: { ...cur, keys: cur.keys.filter(x => x !== k) } } as PadBindings;
                          persistBindings(next);
                        }}
                      >
                        <span className="-mt-[1px]">×</span>
                      </button>
                    </span>
                  ))}
                  {!(bindings[modalForMidi]?.keys || []).length && (
                    <span className="h-8 inline-flex items-center text-xs text-muted-foreground">No mapping</span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] sm:text-base font-semibold">MIDI Notes</div>
                  <button
                    aria-label="Add MIDI binding"
                    className={
                      'inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full border ' +
                      (listenMidiForMidi === modalForMidi
                        ? 'bg-primary/90 border-primary text-primary-foreground'
                        : (selectedId ? 'bg-transparent border-accent/50 text-accent hover:bg-accent/10' : 'bg-transparent border-border text-muted-foreground cursor-not-allowed'))
                    }
                    disabled={!selectedId}
                    onClick={() => {
                      if (!selectedId) return;
                      setListenKeyForMidi(null);
                      setListenCcForMidi(null);
                      setConflictKey(null);
                      setConflictMidi(null);
                      setConflictCc(null);
                      setListenMidiForMidi(modalForMidi);
                    }}
                  >
                    <span className="text-lg leading-none">+</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 content-start items-center min-h-[72px]">
                  <span className="whitespace-nowrap text-sm md:text-base bg-secondary/70 border border-border text-foreground rounded-full h-8 px-3 inline-flex items-center gap-2 opacity-90">
                    Default: {midiNumberToName(modalForMidi)} ({modalForMidi})
                  </span>
                  {(bindings[modalForMidi]?.midis || []).map(n => (
                    <span key={n} className="whitespace-nowrap text-sm md:text-base bg-secondary/70 border border-border text-foreground rounded-full h-8 px-3 inline-flex items-center gap-2">
                      {midiNumberToName(n)} ({n})
                      <button
                        aria-label="Remove"
                        className="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full border border-border text-muted-foreground hover:bg-muted"
                        onClick={() => {
                          const cur = normalizeBinding(bindings[modalForMidi]);
                          const next = { ...bindings, [modalForMidi]: { ...cur, midis: cur.midis.filter(x => x !== n) } } as PadBindings;
                          persistBindings(next);
                        }}
                      >
                        <span className="-mt-[1px]">×</span>
                      </button>
                    </span>
                  ))}
                  {!(bindings[modalForMidi]?.midis || []).length && (
                    <span className="h-8 inline-flex items-center text-xs text-muted-foreground">No mapping</span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] sm:text-base font-semibold">MIDI CC</div>
                  <button
                    aria-label="Add MIDI CC binding"
                    className={
                      'inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full border ' +
                      (listenCcForMidi === modalForMidi
                        ? 'bg-primary/90 border-primary text-primary-foreground'
                        : (selectedId ? 'bg-transparent border-accent/50 text-accent hover:bg-accent/10' : 'bg-transparent border-border text-muted-foreground cursor-not-allowed'))
                    }
                    disabled={!selectedId}
                    onClick={() => {
                      if (!selectedId) return;
                      setListenKeyForMidi(null);
                      setListenMidiForMidi(null);
                      setListenCcForMidi(modalForMidi);
                      setConflictKey(null);
                      setConflictMidi(null);
                      setConflictCc(null);
                    }}
                  >
                    <span className="text-lg leading-none">+</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 content-start items-center min-h-[72px]">
                  {(bindings[modalForMidi]?.ccs || []).map(cc => (
                    <span key={cc} className="whitespace-nowrap text-sm md:text-base bg-secondary/70 border border-border text-foreground rounded-full h-8 px-3 inline-flex items-center gap-2">
                      {ccNumberToName(cc)}
                      <button
                        aria-label="Remove"
                        className="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full border border-border text-muted-foreground hover:bg-muted"
                        onClick={() => {
                          const cur = normalizeBinding(bindings[modalForMidi]);
                          const next = { ...bindings, [modalForMidi]: { ...cur, ccs: cur.ccs.filter(x => x !== cc) } } as PadBindings;
                          persistBindings(next);
                        }}
                      >
                        <span className="-mt-[1px]">×</span>
                      </button>
                    </span>
                  ))}
                  {!(bindings[modalForMidi]?.ccs || []).length && (
                    <span className="h-8 inline-flex items-center text-xs text-muted-foreground">No mapping</span>
                  )}
                </div>
              </div>

              <div className="pt-1 min-h-6">
                {conflictMidi && (
                  <div className="text-xs text-primary">
                    Warning: MIDI note {midiNumberToName(conflictMidi.note)} ({conflictMidi.note}) is already used by {conflictMidi.ownerLabel}.
                  </div>
                )}
                {!conflictMidi && conflictCc && (
                  <div className="text-xs text-primary">
                    Warning: {ccNumberToName(conflictCc.cc)} is already used by {conflictCc.ownerLabel}.
                  </div>
                )}
                {!conflictMidi && !conflictCc && conflictKey && (
                  <div className="text-xs text-primary">Warning: key "{conflictKey.toUpperCase()}" is already used by another sound.</div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setModalForMidi(null); setListenKeyForMidi(null); setListenMidiForMidi(null); setListenCcForMidi(null); setConflictKey(null); setConflictMidi(null); setConflictCc(null); }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
