import { useEffect, useRef } from 'react';

type Props = {
  value: number; // 0..1
  current?: boolean;
  onChange: (v: number) => void; // debounced or on release
  height?: number; // px
};

export default function BeatVolumeBar({ value, current = false, onChange, height = 120 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const debounceTimer = useRef<number | null>(null);
  const DEBOUNCE_MS = 120;

  function setFill(v: number) {
    const el = fillRef.current;
    if (el) el.style.transform = `scaleY(${Math.max(0, Math.min(1, v))})`;
  }

  function scheduleCommit(v: number) {
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      onChange(v);
      debounceTimer.current = null;
    }, DEBOUNCE_MS);
  }

  function computeFromY(clientY: number) {
    const el = containerRef.current!;
    const rect = el.getBoundingClientRect();
    const level = 1 - (clientY - rect.top) / rect.height;
    return Math.max(0, Math.min(1, level));
  }

  useEffect(() => {
    // Sync external value when not dragging
    if (!dragging.current) setFill(value);
  }, [value]);

  return (
    <div className="flex-1 flex flex-col items-center">
      <div
        ref={containerRef}
        className={
          'relative w-8 rounded-md bg-background/80 border border-border/70 cursor-pointer select-none overflow-hidden shadow-inner ' +
          (current ? 'ring-2 ring-accent/50' : '')
        }
        style={{ height, touchAction: 'none' as any }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          const v = computeFromY(e.clientY);
          setFill(v);
          scheduleCommit(v);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const v = computeFromY(e.clientY);
          setFill(v);
          scheduleCommit(v);
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          const v = computeFromY(e.clientY);
          setFill(v);
          onChange(v); // immediate commit on release
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <div
          ref={fillRef}
          className="absolute bottom-0 left-0 right-0 bg-accent will-change-transform"
          style={{ height: '100%', transformOrigin: 'bottom', transform: `scaleY(${value})` }}
        />
      </div>
    </div>
  );
}
