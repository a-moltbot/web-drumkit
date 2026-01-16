import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MidiDevicePicker from './MidiDevicePicker';
import { initMidiCcListenerForInput, initMidiListenerForInput } from '../midi/midi';
import { ensureAudioStarted, getDrumSampler, listDrumPads, triggerMidi, isUsingFallback, DrumPad, triggerPad, midiNoteToPad, MidiCC, setHiHatOpenByCC4 } from '../audio/sampler';
import * as Tone from 'tone';
import { useKeyboardPads, KeyMap } from '../hooks/useKeyboardPads';

type PadBinding = { keys: string[]; midis: number[] };
type PadBindings = Record<number, PadBinding>; // target midi -> bindings

function midiNumberToName(n: number) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(n / 12) - 1;
  const name = names[n % 12];
  return `${name}${octave}`;
}

export default function MidiSampler() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ note?: number; velocity?: number }>({});
  const [flashPad, setFlashPad] = useState<DrumPad | null>(null);
  const [engine, setEngine] = useState<'samples' | 'synth'>(() => (isUsingFallback() ? 'synth' : 'samples'));
  const [loading, setLoading] = useState<boolean>(true);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [modalForMidi, setModalForMidi] = useState<number | null>(null); // target pad midi
  const [listenKeyForMidi, setListenKeyForMidi] = useState<number | null>(null);
  const [listenMidiForMidi, setListenMidiForMidi] = useState<number | null>(null); // target pad midi we capture for
  const [conflictKey, setConflictKey] = useState<string | null>(null);
  const [conflictMidi, setConflictMidi] = useState<{ note: number; ownerLabel: string } | null>(null);
  // no crash/snare variant toggles for now

  // Refs to always read latest data inside MIDI handler without stale closures
  const bindingsRef = useRef<PadBindings>({});
  const defaultMidiSetRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    let disposed = false;
    let disposer: { dispose: () => void } | null = null;
    let ccDisposer: { dispose: () => void } | null = null;
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
              const cur = prev[t] || { keys: [], midis: [] };
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
          if (vel > 0) await triggerMidi(resolved ?? note, vel);
        });
        disposer = d;
        ccDisposer = await initMidiCcListenerForInput(selectedId, (cc, val) => {
          if (disposed) return;
          if (cc === MidiCC.FootController) setHiHatOpenByCC4(val);
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
  }, [selectedId, listenMidiForMidi]);

  const allPads = useMemo(() => listDrumPads(), []);
  const order: DrumPad[] = [
    DrumPad.HiHatClosed, DrumPad.HiHatPedal, DrumPad.HiHatOpen, DrumPad.Crash, DrumPad.Ride, DrumPad.Stick,
    DrumPad.Kick, DrumPad.Snare, DrumPad.TomHigh, DrumPad.TomMid, DrumPad.TomFloor,
  ];
  const pads = useMemo(() => {
    const map = new Map(allPads.map(p => [p.pad, p] as const));
    return order.map(p => map.get(p)).filter(Boolean) as typeof allPads;
  }, [allPads]);

  // Try to preload the sampler as soon as component mounts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Preload sampler; if it fails, module flips to synth fallback internally
        await getDrumSampler();
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        if (!cancelled) {
          setEngine(isUsingFallback() ? 'synth' : 'samples');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePad = useCallback(async (pad: DrumPad) => {
    if (loading) return; // ignore interaction while loading
    if (editMode) {
      const midi = padsByPad.get(pad)?.midi;
      if (midi != null) {
        setModalForMidi(midi);
        setConflictKey(null);
        setConflictMidi(null);
      }
      return;
    }
    setFlashPad(pad);
    setTimeout(() => setFlashPad(prev => (prev === pad ? null : prev)), 120);
    await triggerPad(pad, 100);
  }, [loading, editMode]);

  // Bindings (keys + extra MIDI notes) with persistence
  const BINDING_KEY = 'drum_bindings_v1';
  const LEGACY_KEYMAP_KEY = 'drum_keymap_v1';
  const [bindings, setBindings] = useState<PadBindings>(() => {
    try {
      const raw = localStorage.getItem(BINDING_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    // migrate legacy midiToKeys if present
    let migrated: PadBindings | null = null;
    try {
      const legacy = localStorage.getItem(LEGACY_KEYMAP_KEY);
      if (legacy) {
        const parsed: Record<number, string[]> = JSON.parse(legacy);
        migrated = Object.fromEntries(
          Object.entries(parsed).map(([m, keys]) => [Number(m), { keys: keys || [], midis: [] }])
        ) as PadBindings;
      }
    } catch {}
    if (migrated) return migrated;
    // Start with no key bindings by default
    return {} as PadBindings;
  });

  const padsByPad = useMemo(() => new Map(allPads.map(p => [p.pad, p])), [allPads]);
  const midiToLabel = useMemo(() => Object.fromEntries(allPads.map(p => [p.midi, p.label] as const)), [allPads]);

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
        const pad = midiNoteToPad(midi);
        if (pad) {
          setFlashPad(pad);
          setTimeout(() => setFlashPad(prev => (prev === pad ? null : prev)), 120);
        }
        await ensureAudioStarted();
        await getDrumSampler();
        await triggerMidi(midi, velocity);
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    },
  });

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 rounded border border-gray-700/60 bg-black/20 p-4">
      <h2 className="text-2xl font-semibold">MIDI Sampler (Tone.js)</h2>
      <p className="text-sm text-gray-400">
        Select a MIDI device and hit pads/notes to hear samples.
      </p>
      <div className="flex items-center justify-between gap-3">
        <MidiDevicePicker
          onSelect={(id) => {
          setSelectedId(id || null);
        }}
        />
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-xs px-2 py-1 rounded border border-indigo-700 text-indigo-300">Loading kit…</span>
          )}
          <span className="text-xs px-2 py-1 rounded border border-green-700 text-green-400">Engine: {engine === 'samples' ? 'Samples' : 'Synth fallback'}</span>
        </div>
      </div>
      <div className="relative">
        {editMode && (
          <button
            onClick={() => {
              const ok = window.confirm('Reset all custom key and MIDI bindings?');
              if (!ok) return;
              setListenKeyForMidi(null);
              setListenMidiForMidi(null);
              setConflictKey(null);
              setConflictMidi(null);
              persistBindings({});
            }}
            title="Reset all bindings"
            className={'absolute bottom-2 right-12 z-20 p-2 rounded-full border shadow bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path d="M12 5V2L8 6l4 4V7c3.309 0 6 2.691 6 6a6 6 0 1 1-6-6zm0 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            </svg>
          </button>
        )}
        <button
          onClick={() => setEditMode(v => !v)}
          className={
            'absolute bottom-2 right-2 z-20 p-2 rounded-full border shadow ' +
            (editMode ? 'bg-amber-600/20 border-amber-400 text-amber-200' : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700')
          }
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M19.14,12.94a7.52,7.52,0,0,0,.06-1,7.52,7.52,0,0,0-.06-1l2.11-1.65a.5.5,0,0,0,.12-.64l-2-3.46a.5.5,0,0,0-.6-.22l-2.49,1a7.27,7.27,0,0,0-1.73-1L14.5,1.81A.5.5,0,0,0,14,1.5H10a.5.5,0,0,0-.5.31L8.65,4A7.27,7.27,0,0,0,6.92,5L4.43,4a.5.5,0,0,0-.6.22l-2,3.46a.5.5,0,0,0,.12.64L4.06,9.94a7.52,7.52,0,0,0-.06,1,7.52,7.52,0,0,0,.06,1L1.95,13.59a.5.5,0,0,0-.12.64l2,3.46a.5.5,0,0,0,.6.22l2.49-1a7.27,7.27,0,0,0,1.73,1l.85,2.19A.5.5,0,0,0,10,22.5h4a.5.5,0,0,0,.5-.31l.85-2.19a7.27,7.27,0,0,0,1.73-1l2.49,1a.5.5,0,0,0,.6-.22l2-3.46a.5.5,0,0,0-.12-.64ZM12,15.5A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z" />
          </svg>
        </button>
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/30 backdrop-blur-[1px] rounded">
            <div className="text-sm text-indigo-200">Loading samples…</div>
          </div>
        )}
        <div className={"grid grid-cols-3 sm:grid-cols-6 gap-2 pr-10 pb-12 " + (loading ? 'pointer-events-none opacity-50' : '')}>
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
                'relative px-3 py-4 rounded border text-gray-200 active:scale-95 transition ' +
                (flashPad === p.pad
                  ? 'border-indigo-500 bg-indigo-600/20 shadow'
                  : editMode
                    ? 'border-amber-500/70 bg-amber-500/10 hover:border-amber-400 hover:text-white'
                    : 'border-gray-700 hover:border-indigo-500 hover:text-white')
              }
            >
              <div className="text-lg font-semibold">{p.label}</div>
            </button>
          ))}
        </div>
      </div>
      {/* Modal for bindings */}
      {modalForMidi != null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50">
          <div className="w-full max-w-md rounded-md border border-slate-600 bg-slate-900 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm text-slate-400">Binding for</div>
                  <div className="text-lg font-semibold">{pads.find(p => p.midi === modalForMidi)?.label}</div>
                </div>
              <button className="text-slate-300 hover:text-white" onClick={() => { setModalForMidi(null); setListenKeyForMidi(null); setListenMidiForMidi(null); setConflictKey(null); setConflictMidi(null); }}>×</button>
              </div>
            {/* Settings content */}
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] sm:text-base font-semibold">Keys</div>
                  <button
                    aria-label="Add key binding"
                    className={
                      'inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full border ' +
                      (listenKeyForMidi === modalForMidi
                        ? 'bg-amber-600/80 border-amber-400 text-white'
                        : 'bg-transparent border-indigo-500/50 text-indigo-300 hover:bg-indigo-500/10')
                    }
                    onClick={() => {
                      setListenMidiForMidi(null);
                      setListenKeyForMidi(modalForMidi);
                      setConflictKey(null);
                      const once = (e: KeyboardEvent) => {
                        const k = e.key.toLowerCase();
                        e.preventDefault();
                        const conflict = Object.entries(bindings).some(([m, b]) => Number(m) !== modalForMidi && (b?.keys || []).includes(k));
                        if (conflict) {
                          setConflictKey(k);
                          setListenKeyForMidi(null);
                          return;
                        }
                        const cur = bindings[modalForMidi] || { keys: [], midis: [] };
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
                    <span key={k} className="whitespace-nowrap text-sm md:text-base bg-indigo-500/10 border border-indigo-500/50 text-slate-100 rounded-full h-8 px-3 inline-flex items-center gap-2">
                      {k.toUpperCase()}
                      <button
                        aria-label="Remove"
                        className="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full border border-indigo-400/60 text-indigo-200 hover:bg-indigo-500/20"
                        onClick={() => {
                          const cur = bindings[modalForMidi] || { keys: [], midis: [] };
                          const next = { ...bindings, [modalForMidi]: { ...cur, keys: cur.keys.filter(x => x !== k) } } as PadBindings;
                          persistBindings(next);
                        }}
                      >
                        <span className="-mt-[1px]">×</span>
                      </button>
                    </span>
                  ))}
                  {!(bindings[modalForMidi]?.keys || []).length && (
                    <span className="h-8 inline-flex items-center text-xs text-slate-400">No mapping</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-slate-700 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[15px] sm:text-base font-semibold">MIDI Notes</div>
                  <button
                    aria-label="Add MIDI binding"
                    className={
                      'inline-flex items-center justify-center w-7 h-7 md:w-8 md:h-8 rounded-full border ' +
                      (listenMidiForMidi === modalForMidi
                        ? 'bg-amber-600/80 border-amber-400 text-white'
                        : (selectedId ? 'bg-transparent border-emerald-500/60 text-emerald-300 hover:bg-emerald-500/10' : 'bg-transparent border-slate-600 text-slate-500 cursor-not-allowed'))
                    }
                    disabled={!selectedId}
                    onClick={() => {
                    if (!selectedId) return;
                    setListenKeyForMidi(null);
                    setConflictKey(null);
                    setConflictMidi(null);
                    setListenMidiForMidi(modalForMidi);
                  }}
                  >
                    <span className="text-lg leading-none">+</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 content-start items-center min-h-[72px]">
                  {/* Default target MIDI for this sound (non-removable) */}
                  <span className="whitespace-nowrap text-sm md:text-base bg-emerald-500/10 border border-emerald-500/50 text-slate-100 rounded-full h-8 px-3 inline-flex items-center gap-2 opacity-80">
                    Default: {midiNumberToName(modalForMidi)} ({modalForMidi})
                  </span>
                  {(bindings[modalForMidi]?.midis || []).map(n => (
                    <span key={n} className="whitespace-nowrap text-sm md:text-base bg-emerald-500/10 border border-emerald-500/50 text-slate-100 rounded-full h-8 px-3 inline-flex items-center gap-2">
                      {midiNumberToName(n)} ({n})
                      <button
                        aria-label="Remove"
                        className="inline-flex items-center justify-center w-4 h-4 md:w-5 md:h-5 rounded-full border border-emerald-400/60 text-emerald-200 hover:bg-emerald-500/20"
                        onClick={() => {
                          const cur = bindings[modalForMidi] || { keys: [], midis: [] };
                          const next = { ...bindings, [modalForMidi]: { ...cur, midis: cur.midis.filter(x => x !== n) } } as PadBindings;
                          persistBindings(next);
                        }}
                      >
                        <span className="-mt-[1px]">×</span>
                      </button>
                    </span>
                  ))}
                  {!(bindings[modalForMidi]?.midis || []).length && (
                    <span className="h-8 inline-flex items-center text-xs text-slate-400">No mapping</span>
                  )}
                </div>
              </div>
              {/* Bottom warnings outside the sections */}
              <div className="pt-1 min-h-6">
                {conflictMidi && (
                  <div className="text-xs text-amber-300">Warning: MIDI note {midiNumberToName(conflictMidi.note)} ({conflictMidi.note}) is already used by {conflictMidi.ownerLabel}.</div>
                )}
                {!conflictMidi && conflictKey && (
                  <div className="text-xs text-amber-300">Warning: key "{conflictKey.toUpperCase()}" is already used by another sound.</div>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button className="text-xs px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800" onClick={() => { setModalForMidi(null); setListenKeyForMidi(null); setListenMidiForMidi(null); setConflictKey(null); setConflictMidi(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}
      {/* Debug line removed per request: hide note/velocity numbers */}
      {error && <div className="text-sm text-red-400">{error}</div>}
    </div>
  );
}
