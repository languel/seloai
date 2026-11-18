import { useEffect, useState, useSyncExternalStore } from 'react';
import { anchorPoint, expireOverlay, overlay, overlayVersion, subscribeOverlay, type Drawing } from '../app/overlay';
import { answerRecordingAsk, pendingRecordingAsk, recorderVersion, recordingState, stopRecording, subscribeRecorder } from '../app/recorder';

/**
 * What an agent shows over the whole app: its drawings (in a running stitch, as if sewn on as
 * you watch), the caption of what it is saying, and its pointer. Never takes a click: the layer
 * lets everything through.
 */
export default function AgentOverlay() {
  useSyncExternalStore(subscribeOverlay, overlayVersion);
  useSyncExternalStore(subscribeRecorder, recorderVersion);
  const [, setFrame] = useState(0);
  const ask = pendingRecordingAsk();
  const rec = recordingState();
  const busy = overlay.drawings.length > 0 || overlay.pointer.visible || overlay.caption !== null || Boolean(ask) || rec.recording;

  // While there is anything to show, follow the camera and the layout every frame.
  useEffect(() => {
    if (!busy) return;
    let id = 0;
    const loop = () => {
      expireOverlay(performance.now());
      setFrame((f) => (f + 1) % 1_000_000);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [busy]);

  if (!busy) return null;
  const now = performance.now();
  const p = overlay.pointer;
  const pressAge = now - p.pressedAt;

  return (
    <div data-agent-overlay aria-hidden="true" className="pointer-events-none fixed inset-0 z-[70]">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <marker id="agent-arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
          </marker>
        </defs>
        {overlay.drawings.map((d) => (
          <Shape key={d.id} d={d} now={now} />
        ))}
        {p.visible && (
          <g transform={`translate(${p.x},${p.y})`}>
            {pressAge < 450 && <circle r={6 + (pressAge / 450) * 22} fill="none" stroke="#b0241c" strokeWidth={2} opacity={1 - pressAge / 450} />}
            <path d="M0,0 L0,19 L5,14.5 L8.5,22 L11.5,20.6 L8,13.4 L14.5,13.4 Z" fill="#fffdf7" stroke="#231f1c" strokeWidth={1.4} strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.35))' }} />
          </g>
        )}
      </svg>
      {overlay.drawings
        .filter((d) => d.text)
        .map((d) => (
          <Label key={`l-${d.id}`} d={d} />
        ))}
      {ask && (
        <div className="pointer-events-auto absolute inset-x-0 top-20 flex justify-center px-4">
          <div className="stitch-panel w-[min(92vw,26rem)] p-3 shadow-xl" style={{ background: 'var(--bg-card)' }} role="dialog" aria-label="Record this performance">
            <p className="text-[13px] font-semibold text-ink">Record “{ask.name}”?</p>
            <p className="mt-1 text-[12px] leading-snug text-muted">
              Spinner would like to record the whole app (panels, pointer, drawings and sound) as a video. The browser will ask which tab: choose this one.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => void answerRecordingAsk(true)} className="rounded-sm border border-borderFolk bg-ink/[0.08] px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-ink/[0.12]">
                Start recording
              </button>
              <button type="button" onClick={() => void answerRecordingAsk(false)} className="rounded-sm px-2 py-1 text-[12px] text-muted hover:text-ink">
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Recording the world only: a small badge with Stop. (Recording the app, the browser shows its own bar, and a badge would be in the film.) */}
      {rec.recording && rec.what === 'world' && (
        <div className="pointer-events-auto absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-card/90 px-2.5 py-1 text-[11px] text-ink shadow">
          <span className="h-2 w-2 animate-pulse rounded-full bg-crimson" />
          Recording the world · {Math.floor(rec.seconds ?? 0)} s
          <button type="button" onClick={() => void stopRecording()} className="ml-1 rounded-sm px-1.5 text-muted hover:text-ink">
            Stop and save
          </button>
        </div>
      )}
      {overlay.caption && (
        <div className="absolute inset-x-0 bottom-24 flex justify-center px-6">
          <div className="stitch-panel max-w-[min(90vw,40rem)] px-4 py-2.5 text-center shadow-lg" style={{ background: 'color-mix(in srgb, var(--bg-card) 94%, transparent)' }}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{overlay.caption.speaker}</div>
            <div className="text-[15px] leading-snug text-ink">{overlay.caption.text}</div>
          </div>
        </div>
      )}
    </div>
  );
}

const STITCH = { strokeDasharray: '7 5', strokeLinecap: 'round' as const, strokeWidth: 3, fill: 'none' };

/** A shape being sewn on: the running stitch draws itself in over about half a second. */
function Shape({ d, now }: { d: Drawing; now: number }) {
  const at = anchorPoint(d.at);
  if (!at) return null;
  const colour = d.colour ?? '#b0241c';
  const sewn = { ...STITCH, stroke: colour, style: { color: colour, animation: 'agent-sew 0.6s ease-out both' } };
  const pad = 8;
  if (d.shape === 'ring') {
    const rx = at.w ? at.w / 2 + pad : d.size ?? 30;
    const ry = at.h ? at.h / 2 + pad : (d.size ?? 30) * 0.8;
    return <ellipse cx={at.x} cy={at.y} rx={rx} ry={ry} {...sewn} />;
  }
  if (d.shape === 'box') {
    const w = (at.w ?? 80) + pad * 2;
    const h = (at.h ?? 48) + pad * 2;
    return <rect x={at.x - w / 2} y={at.y - h / 2} width={w} height={h} rx={8} {...sewn} />;
  }
  if (d.shape === 'underline') {
    const w = (at.w ?? 80) + 8;
    const y = at.y + (at.h ?? 20) / 2 + 4;
    return <path d={`M${at.x - w / 2},${y} q${w / 4},3 ${w / 2},0 t${w / 2},0`} {...sewn} />;
  }
  if (d.shape === 'dot') {
    const r = d.size ?? 7;
    const pulse = 1 + 0.15 * Math.sin(now / 220);
    return <circle cx={at.x} cy={at.y} r={r * pulse} fill={colour} opacity={0.85} />;
  }
  if (d.shape === 'arrow') {
    const from = (d.from && anchorPoint(d.from)) || { x: at.x - 120, y: at.y - 90 };
    // Stop just short of the target (outside an interface element's box).
    const stop = (at.w ? Math.max(at.w, at.h ?? 0) / 2 + 6 : 0) + 10;
    const dx = at.x - from.x;
    const dy = at.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = at.x - (dx / len) * stop;
    const ty = at.y - (dy / len) * stop;
    // A gentle curve, as a hand would draw it.
    const cx = (from.x + tx) / 2 - dy * 0.18;
    const cy = (from.y + ty) / 2 + dx * 0.18;
    return <path d={`M${from.x},${from.y} Q${cx},${cy} ${tx},${ty}`} {...sewn} markerEnd="url(#agent-arrowhead)" />;
  }
  return null;
}

/** A drawing's words, on a small stitched card: beyond an arrow's tail, or beside the thing marked. */
function Label({ d }: { d: Drawing }) {
  const at = anchorPoint(d.at);
  if (!at) return null;
  let style: React.CSSProperties;
  if (d.shape === 'arrow') {
    // The card sits past the tail, so the whole arrow shows between it and its target.
    const tail = (d.from && anchorPoint(d.from)) || { x: at.x - 120, y: at.y - 90 };
    // Past the tail on its own side, unless that would run off the screen (then the other side).
    const leftward = tail.x - at.x <= 0 ? tail.x > 260 : tail.x > innerWidth - 260;
    const upward = tail.y - at.y <= 0 ? tail.y > 70 : tail.y > innerHeight - 70;
    style = {
      left: tail.x,
      top: tail.y,
      transform: `translate(${leftward ? '-100%' : '0'}, ${upward ? '-100%' : '0'}) translate(${leftward ? -6 : 6}px, ${upward ? -6 : 6}px)`,
    };
  } else {
    style = { left: at.x + (at.w ? at.w / 2 + 14 : 18), top: at.y - (at.h ? at.h / 2 : 0) - 8, transform: 'translateY(-50%)' };
  }
  return (
    <div
      className="stitch-panel absolute max-w-[250px] whitespace-normal px-2.5 py-1.5 leading-snug text-ink shadow-md"
      style={{ ...style, fontSize: d.size && d.shape === 'label' ? d.size : 13, background: 'color-mix(in srgb, var(--bg-card) 95%, transparent)', animation: 'agent-fade 0.35s ease-out both' }}
    >
      {d.text}
    </div>
  );
}
