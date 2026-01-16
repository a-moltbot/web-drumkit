import { useEffect, useMemo, useState } from 'react';
import { getMIDIAccess, listMidiInputs } from '../midi/midi';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

type Props = {
  onSelect: (id: string, device: WebMidi.MIDIInput | null) => void;
};

export default function MidiDevicePicker({ onSelect }: Props) {
  const [supported, setSupported] = useState<boolean>(
    typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  );
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<
    Array<{ id: string; name?: string; manufacturer?: string }>
  >([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let access: WebMidi.MIDIAccess | null = null;
    (async () => {
      try {
        access = await getMIDIAccess();
        const refresh = async () => {
          const list = await listMidiInputs();
          if (disposed) return;
          setDevices(list);
          // If selected device disappeared, clear selection
          if (selectedId && !list.some(d => d.id === selectedId)) {
            setSelectedId(null);
            onSelect('', null);
          }
        };
        await refresh();
        access.onstatechange = () => {
          refresh();
        };
      } catch (e: any) {
        setError(e?.message || String(e));
        setSupported(false);
      }
    })();
    return () => {
      disposed = true;
      if (access && access.onstatechange) access.onstatechange = null;
    };
  }, [onSelect, selectedId]);

  const handleClick = async (id: string) => {
    // Toggle selection: clicking the selected device will deselect
    if (selectedId === id) {
      setSelectedId(null);
      onSelect('', null);
      return;
    }
    setSelectedId(id);
    try {
      const access = await getMIDIAccess();
      // find the actual device to pass up if needed
      let found: WebMidi.MIDIInput | null = null;
      const anyInputs: any = access.inputs as any;
      if (typeof anyInputs.values === 'function') {
        for (const input of anyInputs.values()) {
          if (input.id === id) {
            found = input as WebMidi.MIDIInput;
            break;
          }
        }
      }
      onSelect(id, found);
    } catch {
      onSelect(id, null);
    }
  };

  const content = useMemo(() => {
    if (!supported) return <p className="text-sm text-muted-foreground">Web MIDI not supported.</p>;
    if (error) return <p className="text-sm text-destructive">{error}</p>;
    if (!devices.length)
      return <p className="text-sm text-muted-foreground">No MIDI inputs found.</p>;
    return (
      <div className="flex flex-wrap gap-2">
        {devices.map(d => {
          const isSelected = d.id === selectedId;
          return (
            <Button
              key={d.id}
              onClick={() => handleClick(d.id)}
              variant={isSelected ? 'accent' : 'outline'}
              size="sm"
              className={isSelected ? 'shadow-sm' : 'bg-background/70'}
              title={d.manufacturer ? `${d.manufacturer} ${d.name ?? ''}` : d.name ?? d.id}
            >
              {d.name ?? d.id}
            </Button>
          );
        })}
      </div>
    );
  }, [devices, error, selectedId, supported]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-medium">MIDI Devices</h3>
        <div className="flex items-center gap-2">
          {selectedId ? (
            <>
              <Badge variant="accent">Selected</Badge>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setSelectedId(null);
                  onSelect('', null);
                }}
              >
                Clear
              </Button>
            </>
          ) : (
            <Badge variant="secondary">Not selected</Badge>
          )}
        </div>
      </div>
      {content}
    </div>
  );
}
