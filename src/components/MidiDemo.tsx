import { useEffect, useState } from 'react';
import { initMidiListenerForInput } from '../midi/midi';
import MidiDevicePicker from './MidiDevicePicker';

type LastEvent = {
  note: number | null;
  velocity: number | null;
  channel: number | null;
  device: string | null;
  time: number | null;
  bytes: string | null;
};

export default function MidiDemo() {
  const [supported, setSupported] = useState<boolean>(
    typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  );
  const [error, setError] = useState<string | null>(null);
  const [evt, setEvt] = useState<LastEvent>({
    note: null,
    velocity: null,
    channel: null,
    device: null,
    time: null,
    bytes: null,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let disposer: { dispose: () => void } | null = null;
    if (!selectedId) {
      // Not selected; do not initialize MIDI listening
      setEvt({ note: null, velocity: null, channel: null, device: null, time: null, bytes: null });
      return () => {};
    }
    (async () => {
      try {
        const d = await initMidiListenerForInput(selectedId, (note, velocity, raw) => {
          if (disposed) return;
          const status = raw.data[0];
          const channel = (status & 0x0f) + 1; // 1-16
          const device = (raw.target && (raw.target as any).name) || null;
          const bytes = Array.from(raw.data)
            .map(b => b.toString(16).padStart(2, '0'))
            .join(' ');
          setEvt({
            note,
            velocity,
            channel,
            device,
            time: raw.receivedTime,
            bytes,
          });
        });
        disposer = d;
      } catch (e: any) {
        setError(e?.message || String(e));
        setSupported(false);
      }
    })();
    return () => {
      disposed = true;
      try {
        disposer?.dispose();
      } catch {}
    };
  }, [selectedId]);

  return (
    <div className="w-full max-w-xl mx-auto space-y-4">
      <h2 className="text-2xl font-semibold">MIDI Input Demo</h2>
      <p className="text-sm text-muted-foreground">
        Connect a MIDI keyboard/controller and press some notes. We display the
        current note and velocity from Note On/Off messages.
      </p>
      <MidiDevicePicker
        onSelect={(id, device) => {
          setSelectedId(id || null);
          setEvt(prev => ({
            ...prev,
            device: device?.name ?? null,
            note: id ? prev.note : null,
            velocity: id ? prev.velocity : null,
            channel: id ? prev.channel : null,
            bytes: id ? prev.bytes : null,
          }));
        }}
      />
      <div className="rounded-xl border border-border/70 bg-background/70 p-4 grid grid-cols-2 gap-3 shadow-sm">
        <Info label="Supported" value={supported ? 'Yes' : 'No'} />
        <Info label="Device" value={evt.device ?? (selectedId ? selectedId : '-')} />
        <Info label="Note" value={evt.note ?? '-'} />
        <Info label="Velocity" value={evt.velocity ?? '-'} />
        <Info label="Channel" value={evt.channel ?? '-'} />
        <Info label="Bytes" value={evt.bytes ?? '-'} mono />
      </div>
      {error && (
        <div className="text-destructive text-sm">Error: {error}</div>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-lg' : 'text-lg font-medium'}>
        {value}
      </span>
    </div>
  );
}
