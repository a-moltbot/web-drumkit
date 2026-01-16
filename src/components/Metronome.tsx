import { useEffect, useMemo, useState } from 'react';
import * as M from '../audio/metronome';
import BeatVolumeBar from './BeatVolumeBar';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

// BeatVolumeBar moved to its own file

export default function Metronome() {
  const [bpm, setBpm] = useState(100);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [beatInBar, setBeatInBar] = useState(0);
  const [accents, setAccents] = useState<boolean[]>([]);
  const [volumes, setVolumes] = useState<number[]>([]); // 0..1 per beat
  useEffect(() => {
    const s = M.getState();
    setBpm(s.bpm);
    setBeats(s.beatsPerBar);
    setRunning(s.isRunning);
    if (Array.isArray((s as any).accents)) setAccents((s as any).accents as boolean[]);
    else setAccents(new Array(s.beatsPerBar).fill(false).map((_, i) => i === 0));
    if (Array.isArray((s as any).volumes)) setVolumes((s as any).volumes as number[]);
    else setVolumes(new Array(s.beatsPerBar).fill(1));
    M.onTick((beatIdx) => setBeatInBar(beatIdx));
    return () => M.onTick(null);
  }, []);

  const indicators = useMemo(() => new Array(beats).fill(0).map((_, i) => i), [beats]);
  const minBpm = 30;
  const maxBpm = 300;
  const pct = Math.round(((bpm - minBpm) / (maxBpm - minBpm)) * 100);

  // no global drag handlers; children handle their own pointer events

  return (
    <Card className="relative overflow-hidden bg-card/85 backdrop-blur">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="font-display text-3xl">Metronome</CardTitle>
            <CardDescription>Dial tempo, volume, and accents for each beat.</CardDescription>
          </div>
          <Badge variant="secondary">Beats: {beats}</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="text-4xl font-semibold tracking-tight">
            {bpm} <span className="text-base text-muted-foreground align-baseline">BPM</span>
          </div>
          <Button
            onClick={async () => {
              await M.toggle();
              const s = M.getState();
              setRunning(s.isRunning);
            }}
            aria-label={running ? 'Stop' : 'Play'}
            variant={running ? 'destructive' : 'accent'}
            size="icon"
            className="h-12 w-12 rounded-full shadow"
          >
            {running ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
                <rect x="5" y="5" width="10" height="10" rx="1" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6">
                <path d="M6 4.5v11l10-5.5-10-5.5z" />
              </svg>
            )}
          </Button>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center gap-2 flex-1">
            <Button
              onClick={() => {
                const v = Math.max(minBpm, Math.min(maxBpm, bpm - 1));
                setBpm(v);
                M.setBpm(v);
              }}
              aria-label="Decrease BPM"
              variant="outline"
              size="icon"
            >
              −
            </Button>
            <input
              type="range"
              min={minBpm}
              max={maxBpm}
              step={1}
              value={bpm}
              aria-label="BPM"
              onChange={e => {
                const v = Number(e.target.value);
                setBpm(v);
                M.setBpm(v);
              }}
              className="slider flex-1"
              style={{ ['--val' as any]: `${pct}%` }}
            />
            <Button
              onClick={() => {
                const v = Math.max(minBpm, Math.min(maxBpm, bpm + 1));
                setBpm(v);
                M.setBpm(v);
              }}
              aria-label="Increase BPM"
              variant="outline"
              size="icon"
            >
              +
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Beats</label>
            <select
              value={beats}
              onChange={e => {
                const v = Number(e.target.value);
                setBeats(v);
                const nextAcc = new Array(v).fill(false);
                for (let i = 0; i < Math.min(accents.length, v); i++) nextAcc[i] = accents[i];
                setAccents(nextAcc);
                const nextVols = new Array(v).fill(1);
                for (let i = 0; i < Math.min(volumes.length, v); i++) nextVols[i] = volumes[i];
                setVolumes(nextVols);
                M.setBeatsPerBar(v);
                M.setAccents(nextAcc);
                M.setVolumes(nextVols);
              }}
              className="rounded-md border border-input bg-background px-2 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {[2, 3, 4, 6].map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/50 px-4 py-3" style={{ height: 160 }}>
          <div className="flex items-end gap-3 h-full">
            {indicators.map(i => (
              <BeatVolumeBar
                key={`bar-${i}`}
                value={volumes[i] ?? 1}
                current={i === beatInBar}
                onChange={(v) => {
                  const next = [...volumes];
                  next[i] = v;
                  setVolumes(next);
                  M.setVolumeForBeat(i, v);
                }}
                height={120}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          {indicators.map(i => (
            <div className="flex-1 flex justify-center" key={`accent-${i}`}>
              <button
                onClick={() => {
                  const next = [...accents];
                  next[i] = !next[i];
                  setAccents(next);
                  M.setAccentForBeat(i, next[i]);
                }}
                className={
                  'h-7 w-7 rounded-full border transition ' +
                  (accents[i]
                    ? 'bg-accent border-accent/80 shadow'
                    : 'bg-background border-input hover:bg-muted')
                }
                aria-label={`Toggle hard beat ${i + 1}`}
                title={`Toggle hard beat: ${i + 1}`}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
