import { useMemo } from 'react';
import { momentText, noteName, type Moment } from '../../engine/moment';
import type { ModelSettings } from '../../engine/types';
import { describeCue, type MusicEvent, type MusicPhrase } from '../../music/villageMusic';
import { AskBox } from './AskBox';

function when(t: number, now: number) {
  const s = Math.round((now - t) / 1000);
  if (Math.abs(s) < 1) return 'now';
  const a = Math.abs(s);
  const body = a < 60 ? `${a}s` : a < 3600 ? `${Math.floor(a / 60)}m ${a % 60}s` : `${Math.floor(a / 3600)}h ${Math.round((a % 3600) / 60)}m`;
  return s > 0 ? `${body} ago` : `in ${body}`;
}

/** The probed moment: what was playing, where everyone was and how they seemed, and a question box. */
export function ProbePanel({ moment, now, settings, onClear, onFocusMusic }: { moment: Moment; now: number; settings: ModelSettings; onClear: () => void; onFocusMusic: () => void }) {
  const mu = moment.music;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto thin-scroll">
      <div className="flex items-baseline gap-2">
        <div className="font-display text-sm">The probe</div>
        <span className="stitch-muted">{when(moment.t, now)}</span>
        <span className="flex-1" />
        <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={onClear} title="Take the probe away (Escape)">
          Take away
        </button>
      </div>
      <section className="space-y-0.5 leading-snug">
        <div className="font-semibold">Music</div>
        {mu ? (
          <>
            <div>
              {mu.part === 'between' ? 'an in-between motif' : mu.part}
              {mu.cut ? ' (given way to a line)' : ''}: {mu.label}
            </div>
            <div className="stitch-muted">
              {mu.mood} · {mu.mode} · {mu.dance} · intensity {mu.intensity.toFixed(2)} · {mu.texture}
            </div>
            {mu.reason && <div className="stitch-muted">because: {mu.reason}</div>}
            {mu.sounding.length > 0 && (
              <div className="font-mono text-[10px]">{mu.sounding.map((s) => (s.midi !== undefined ? `${s.instrument} ${noteName(s.midi)}` : `${s.instrument} ${s.kind}`)).join(' · ')}</div>
            )}
            <button type="button" className="glyph-button rounded-sm px-1 py-0.5" onClick={onFocusMusic}>
              Open the music here
            </button>
          </>
        ) : (
          <div className="stitch-muted">Nothing recorded then (the music was off, or the page was not open).</div>
        )}
        {moment.musicEvents.length > 0 && (
          <div className="stitch-muted text-[10px]">Latest instructions: {moment.musicEvents.map((e) => e.text).join('; ')}</div>
        )}
      </section>
      <section className="space-y-1 leading-snug">
        <div className="font-semibold">Everyone</div>
        {moment.characters.map((c) => (
          <div key={c.id}>
            <span className="font-semibold">{c.name}</span>
            <span className="stitch-muted">
              {' '}
              · {c.place ?? 'between places'}
              {c.state ? ` · ${c.state}` : ''}
              {c.headingTo ? ` · heading to ${c.headingTo}` : ''}
            </span>
            {c.intention && <div className="stitch-muted">means to: {c.intention}</div>}
            {c.lastThought && <div className="italic">“{c.lastThought.text}”</div>}
            {c.lastLine && (
              <div>
                “{c.lastLine.text}” <span className="stitch-muted">{when(c.lastLine.t, moment.t).replace('ago', 'before')}</span>
              </div>
            )}
          </div>
        ))}
      </section>
      {moment.scribe && (
        <section className="leading-snug">
          <div className="font-semibold">The Scribe had just told</div>
          <div className="italic">{moment.scribe.text}</div>
        </section>
      )}
      <section className="space-y-1">
        <div className="font-semibold">Ask about this moment</div>
        <AskBox
          context={() => momentText(moment, Date.now())}
          settings={settings}
          placeholder="e.g. What is the music doing here, and does it fit? How is Baba Rada feeling?"
          spinnerPreface="A question about one moment of the story, from the Loom's probe in the Control Room. Answer about this moment; change nothing unless I ask."
        />
      </section>
    </div>
  );
}

/** One phrase of the band's music, note by note like a DAW's event list, and a question box. */
export function PhrasePanel({ phrase, events, now, settings, onClose }: { phrase: MusicPhrase; events: readonly MusicEvent[]; now: number; settings: ModelSettings; onClose: () => void }) {
  const p = phrase.plan;
  const end = phrase.cutAt ?? phrase.t1;
  const near = events.filter((e) => e.t >= phrase.t0 - 15_000 && e.t <= end);
  const played = (t: number) => phrase.t0 + t * 1000 < end;
  const text = useMemo(() => phraseText(phrase, near), [phrase, near]);
  const tapan = p.tapan.filter((h) => played(h.t));
  const unit = p.unit ?? 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto thin-scroll">
      <div className="flex items-baseline gap-2">
        <div className="font-display text-sm">A phrase</div>
        <span className="stitch-muted">{when(phrase.t0, now)}</span>
        <span className="flex-1" />
        <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="leading-snug">
        <div>
          {phrase.part === 'between' ? 'In-between motif' : phrase.part === 'song' ? 'Song' : 'Ambience'}: {p.label}
        </div>
        <div className="stitch-muted">
          {p.mood} · {p.mode} · {p.dance} · {p.texture} · intensity {p.intensity.toFixed(2)} · {((end - phrase.t0) / 1000).toFixed(1)}s{phrase.cutAt ? ` (cut short of ${p.length.toFixed(1)}s by a line)` : ''}
          {unit ? ` · unit ${unit.toFixed(3)}s` : ''} · drone {p.drone.toFixed(2)}
          {p.droneDegree ? ` on degree ${p.droneDegree}` : ''}
        </div>
        <div className="stitch-muted">asked for: {describeCue(phrase.cue)}</div>
      </div>
      {near.length > 0 && (
        <section className="leading-snug">
          <div className="font-semibold">Instructions around it</div>
          {near.map((e, i) => (
            <div key={i}>
              <span className="stitch-muted">{when(e.t, phrase.t0).replace('ago', 'before').replace(/^in /, '+')} · {e.kind}: </span>
              {e.text}
            </div>
          ))}
        </section>
      )}
      {(['kaval', 'gaida'] as const).map((inst) =>
        inst === 'gaida' && !p.gaidaOn ? null : p[inst].length === 0 ? null : (
          <section key={inst}>
            <div className="font-semibold">
              {inst} <span className="stitch-muted font-normal">· {p[inst].length} notes</span>
            </div>
            <table className="w-full font-mono text-[10px]">
              <thead className="stitch-muted text-left">
                <tr>
                  <th className="font-normal">at</th>
                  <th className="font-normal">note</th>
                  <th className="font-normal">len</th>
                  <th className="font-normal">vel</th>
                  <th className="font-normal">ornament</th>
                </tr>
              </thead>
              <tbody>
                {p[inst].map((n, i) => (
                  <tr key={i} className={played(n.t) ? '' : 'opacity-40 line-through'}>
                    <td>{n.t.toFixed(2)}</td>
                    <td>{noteName(n.midi)}</td>
                    <td>{n.dur.toFixed(2)}</td>
                    <td>{n.vel.toFixed(2)}</td>
                    <td>{[n.graces?.length ? `grace ${n.graces.map(noteName).join(' ')}` : '', n.glideFrom !== undefined ? `glide from ${noteName(n.glideFrom)}` : '', n.trillTo !== undefined ? `trill ${noteName(n.trillTo)}` : ''].filter(Boolean).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ),
      )}
      {tapan.length > 0 && (
        <section>
          <div className="font-semibold">
            tapan <span className="stitch-muted font-normal">· {tapan.length} hits</span>
          </div>
          <div className="break-all font-mono text-[10px] leading-snug">{tapan.map((h) => `${h.kind === 'dum' ? 'DUM' : 'tek'}@${h.t.toFixed(2)}`).join(' ')}</div>
        </section>
      )}
      <section className="space-y-1">
        <div className="font-semibold">Talk about this phrase</div>
        <AskBox
          context={() => text}
          settings={settings}
          scribeLabel="Ask the Scribe"
          placeholder="e.g. Keep this kaval figure for her scenes; drop the tapan under the lament."
          spinnerPreface="About one phrase the village band played (from the Loom's music lane in the Control Room). I want to talk about what to keep and what to change in the music."
        />
        <button type="button" className="glyph-button rounded-sm px-1.5 py-0.5" onClick={() => void navigator.clipboard?.writeText(text)}>
          Copy the phrase as text
        </button>
      </section>
    </div>
  );
}

/** A phrase in words, notes and all, for Spinner or the clipboard. */
export function phraseText(phrase: MusicPhrase, events: readonly MusicEvent[]): string {
  const p = phrase.plan;
  const end = phrase.cutAt ?? phrase.t1;
  const played = (t: number) => phrase.t0 + t * 1000 < end;
  const lines = [
    `A phrase of the village band at ${new Date(phrase.t0).toLocaleTimeString()}: ${phrase.part}, "${p.label}".`,
    `mood ${p.mood}, mode ${p.mode}, dance ${p.dance}, texture ${p.texture}, intensity ${p.intensity.toFixed(2)}, length ${((end - phrase.t0) / 1000).toFixed(1)}s${phrase.cutAt ? ' (cut short by a line)' : ''}, drone ${p.drone.toFixed(2)}${p.droneDegree ? ` on degree ${p.droneDegree}` : ''}.`,
    `The band was asked for: ${describeCue(phrase.cue)}.`,
  ];
  if (events.length) lines.push(`Instructions around it: ${events.map((e) => `${e.kind}: ${e.text}`).join('; ')}.`);
  for (const inst of ['kaval', 'gaida'] as const) {
    if (inst === 'gaida' && !p.gaidaOn) continue;
    const notes = p[inst].filter((n) => played(n.t));
    if (notes.length) lines.push(`${inst}: ${notes.map((n) => `${noteName(n.midi)}@${n.t.toFixed(2)}+${n.dur.toFixed(2)}`).join(' ')}`);
  }
  const hits = p.tapan.filter((h) => played(h.t));
  if (hits.length) lines.push(`tapan: ${hits.map((h) => `${h.kind}@${h.t.toFixed(2)}`).join(' ')}`);
  return lines.join('\n');
}
