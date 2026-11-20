import { useMemo, useState, useSyncExternalStore } from 'react';
import { momentText, noteName, type Moment } from '../../engine/moment';
import type { ModelSettings } from '../../engine/types';
import { describeCue, villageMusic, type MusicEvent, type MusicPhrase } from '../../music/villageMusic';
import { describeRule, type RuleDraft } from '../../music/bandRules';
import { DANCES } from '../../music/theory';
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
      <KeepOrLeave phrase={phrase} />
      <section className="space-y-1">
        <div className="font-semibold">Talk about this phrase</div>
        <AskBox
          context={() => text}
          settings={settings}
          scribeLabel="Ask the Scribe"
          placeholder="e.g. Keep this kaval figure for her scenes; drop the tapan under the lament."
          spinnerPreface="About one phrase the village band played (from the Loom's music lane in the Control Room). I want to talk about what to keep and what to change in the music. To make it stick, use band_rules (keep_figure with this phrase's id, or add a rule), and say what you set."
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
    `A phrase of the village band at ${new Date(phrase.t0).toLocaleTimeString()} (phrase_id ${phrase.id}): ${phrase.part}, "${p.label}".`,
    `mood ${p.mood}, mode ${p.mode}, dance ${p.dance}, texture ${p.texture}, intensity ${p.intensity.toFixed(2)}, length ${((end - phrase.t0) / 1000).toFixed(1)}s${phrase.cutAt ? ' (cut short by a line)' : ''}, drone ${p.drone.toFixed(2)}${p.droneDegree ? ` on degree ${p.droneDegree}` : ''}.`,
    `The band was asked for: ${describeCue(phrase.cue)}.`,
  ];
  if (events.length) lines.push(`Instructions around it: ${events.map((e) => `${e.kind}: ${e.text}`).join('; ')}.`);
  const shaped = (p.rules ?? []).map((id) => villageMusic.rules.find((r) => r.id === id)).filter(Boolean);
  if (shaped.length) lines.push(`Band rules that shaped it: ${shaped.map((r) => describeRule(r!)).join('; ')}.`);
  if (villageMusic.rules.length) lines.push(`All the band's rules now: ${villageMusic.rules.map((r) => `${r.id}: ${describeRule(r)}`).join('; ')}.`);
  for (const inst of ['kaval', 'gaida'] as const) {
    if (inst === 'gaida' && !p.gaidaOn) continue;
    const notes = p[inst].filter((n) => played(n.t));
    if (notes.length) lines.push(`${inst}: ${notes.map((n) => `${noteName(n.midi)}@${n.t.toFixed(2)}+${n.dur.toFixed(2)}`).join(' ')}`);
  }
  const hits = p.tapan.filter((h) => played(h.t));
  if (hits.length) lines.push(`tapan: ${hits.map((h) => `${h.kind}@${h.t.toFixed(2)}`).join(' ')}`);
  return lines.join('\n');
}

/**
 * Keep it or leave it out: one click makes a standing rule for the band from this phrase,
 * held to moments like it (its mood and part). The rules that shaped it, and all of them, below.
 */
function KeepOrLeave({ phrase }: { phrase: MusicPhrase }) {
  useSyncExternalStore(villageMusic.subscribe, villageMusic.getVersion);
  const [note, setNote] = useState<string | null>(null);
  const p = phrase.plan;
  const when = { mood: p.mood, part: phrase.part };
  const scope = `${p.mood}, ${phrase.part === 'between' ? 'in-between' : phrase.part}`;
  const add = (draft: RuleDraft) => {
    try {
      const r = villageMusic.addRule(draft);
      setNote(`Set: ${describeRule(r)}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };
  const keep = (instrument: 'kaval' | 'gaida') => {
    try {
      const r = villageMusic.keepFigure(phrase.id, { instrument });
      setNote(`Set: ${describeRule(r)}.`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    }
  };
  const shaped = (p.rules ?? []).map((id) => villageMusic.rules.find((r) => r.id === id)).filter((r) => r !== undefined);
  const btn = 'glyph-button rounded-sm px-1.5 py-0.5 text-left';
  const melodic = phrase.part !== 'ambience' && p.texture !== 'drone';
  return (
    <section className="space-y-1">
      <div className="font-semibold">
        Keep or leave out <span className="stitch-muted font-normal">· in {scope}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {melodic && p.kaval.length > 0 && (
          <button type="button" className={btn} onClick={() => keep('kaval')} title="The band plays this kaval figure again in moments like this, moved into their mode">
            Keep this kaval figure
          </button>
        )}
        {melodic && p.gaidaOn && p.gaida.length > 0 && (
          <button type="button" className={btn} onClick={() => keep('gaida')}>
            Keep this gaida figure
          </button>
        )}
        {p.tapan.length > 0 && (
          <>
            <button type="button" className={btn} onClick={() => add({ kind: 'thin', instrument: 'tapan', amount: 0.5, when })}>
              Less tapan
            </button>
            <button type="button" className={btn} onClick={() => add({ kind: 'thin', instrument: 'tapan', amount: 1, when })}>
              No tapan
            </button>
          </>
        )}
        {p.gaidaOn && p.gaida.length > 0 && (
          <button type="button" className={btn} onClick={() => add({ kind: 'thin', instrument: 'gaida', amount: 1, when })}>
            No gaida
          </button>
        )}
        {p.kaval.some((n) => n.graces?.length || n.glideFrom !== undefined || n.trillTo !== undefined) && (
          <button type="button" className={btn} onClick={() => add({ kind: 'no-ornaments', instrument: 'kaval', ornaments: ['graces', 'glide', 'trill'], when })}>
            Plain kaval, no ornaments
          </button>
        )}
        {p.drone > 0.05 && (
          <button type="button" className={btn} onClick={() => add({ kind: 'thin', instrument: 'drone', amount: 0.5, when })}>
            Softer drone
          </button>
        )}
        {p.dance !== 'free' && (
          <>
            <button type="button" className={btn} onClick={() => add({ kind: 'prefer-dance', dance: p.dance, when: { mood: p.mood } })}>
              Always this dance in {p.mood}
            </button>
            <button type="button" className={btn} onClick={() => add({ kind: 'avoid-dance', dance: p.dance, when: { mood: p.mood } })}>
              Not the {DANCES[p.dance].label.split(' (')[0]} in {p.mood}
            </button>
          </>
        )}
      </div>
      {note && <div className="stitch-muted leading-snug">{note}</div>}
      {shaped.length > 0 && (
        <div className="leading-snug">
          <span className="stitch-muted">Shaped by: </span>
          {shaped.map((r) => describeRule(r)).join('; ')}
        </div>
      )}
      <BandRulesList />
    </section>
  );
}

/** Every standing rule of the band, each with a way to drop it. */
export function BandRulesList() {
  useSyncExternalStore(villageMusic.subscribe, villageMusic.getVersion);
  const rules = villageMusic.rules;
  if (rules.length === 0) return null;
  return (
    <div className="space-y-0.5 border-t border-dashed border-borderFolk pt-1">
      <div className="font-semibold">
        The band's rules <span className="stitch-muted font-normal">· {rules.length}</span>
      </div>
      <ol className="space-y-0.5">
        {rules.map((r) => (
          <li key={r.id} className="flex items-start gap-1 leading-snug">
            <span className="min-w-0 flex-1">
              <span className="stitch-thread">§ </span>
              {describeRule(r)}
              {r.reason ? <span className="stitch-muted"> · {r.reason}</span> : null}
            </span>
            <button type="button" aria-label="Drop this rule" title="Drop this rule" className="glyph-button rounded-sm px-1 leading-none" onClick={() => villageMusic.removeRule(r.id)}>
              ×
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
