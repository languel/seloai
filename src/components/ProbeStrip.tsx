import { useRef } from 'react';
import { setProbe } from '../app/momentProbe';

function ago(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 6) / 10}h ago`;
}

/**
 * A slim length of the story from its start to now: the live needle at the right, the probe
 * where it was placed. Click or drag along it to move the probe.
 */
export function ProbeStrip({ start, now, probe }: { start: number; now: number; probe: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const span = Math.max(1, now - start);
  const tOf = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return start + f * span;
  };
  const frac = (t: number) => `${(Math.max(0, Math.min(1, (t - start) / span)) * 100).toFixed(2)}%`;
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="The probed moment"
      aria-valuemin={0}
      aria-valuemax={Math.round(span / 1000)}
      aria-valuenow={probe === null ? undefined : Math.round((probe - start) / 1000)}
      aria-valuetext={probe === null ? 'no probe' : ago(now - probe)}
      tabIndex={0}
      className="relative h-6 flex-1 cursor-pointer touch-none select-none rounded-sm"
      style={{ background: 'repeating-linear-gradient(90deg, color-mix(in srgb, var(--text-ink) 18%, transparent) 0 4px, transparent 4px 8px) center / 100% 1px no-repeat' }}
      onPointerDown={(e) => {
        ref.current!.setPointerCapture(e.pointerId);
        setProbe(tOf(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) setProbe(tOf(e.clientX));
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 30_000 : 5_000;
        const at = probe ?? now;
        if (e.key === 'ArrowLeft') setProbe(Math.max(start, at - step));
        else if (e.key === 'ArrowRight') setProbe(Math.min(now, at + step));
        else if (e.key === 'Escape') setProbe(null);
        else return;
        e.preventDefault();
      }}
    >
      <span className="stitch-muted pointer-events-none absolute left-0 top-0 text-[9px]">{ago(now - start)}</span>
      <span className="pointer-events-none absolute top-0 h-full w-[2px] bg-amberFolk" style={{ left: 'calc(100% - 2px)' }} title="now" />
      {probe !== null && (
        <span className="pointer-events-none absolute top-0 h-full" style={{ left: frac(probe) }}>
          <span className="absolute -left-[1px] top-0 h-full w-[2px] bg-indigoFolk" />
          <span className="absolute -left-[4px] top-0 h-[8px] w-[8px] bg-indigoFolk" />
          <span className="absolute left-2 top-[9px] whitespace-nowrap text-[9px] text-indigoFolk">{ago(now - probe)}</span>
        </span>
      )}
    </div>
  );
}
