import React from 'react';

type Props = {
  label: string;
  midi: number;
  trigger: (midi: number, velocity?: number) => void;
  stop?: (midi: number) => void;
  hotkey?: string; // display only
  active?: boolean;
};

export const DrumPad: React.FC<Props> = ({ label, midi, trigger, stop, hotkey, active }) => {
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const accent = e.shiftKey ? 120 : 100;
    trigger(midi, accent);
  };
  const onMouseUp = () => stop?.(midi);

  return (
    <button
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      className={
        `relative aspect-square w-24 rounded-xl border transition select-none shadow-sm ` +
        (active
          ? 'bg-accent text-accent-foreground border-accent scale-95'
          : 'bg-background/80 border-border hover:border-accent/60 hover:bg-accent/10')
      }
    >
      <span className="block text-sm font-semibold">{label}</span>
      {hotkey && (
        <span className="absolute bottom-1 right-2 text-xs text-muted-foreground opacity-80">
          {hotkey.toUpperCase()}
        </span>
      )}
    </button>
  );
};
