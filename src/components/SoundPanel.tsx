import React, { useSyncExternalStore } from 'react';
import { mixerLevels, mixerVersion, setLevel, subscribeMixer, type MixerChannel } from '../ai/mixer';
import { SOUND_MODES, applySoundMode, currentSoundMode } from '../app/soundModes';
import type { ModelSettings } from '../engine/types';
import { TONE_PRESETS, type DroneVoicing, type VoiceTone } from '../music/tone';
import { villageMusic } from '../music/villageMusic';

/**
 * The Sound panel: a small mixer for everything heard in the village. Each source has a level
 * and, where it makes sense, how much of it there is: how much the characters talk, how much
 * the Scribe tells, how much music. Listening modes set all of it at once ("Ambient" is only
 * music and people at their work). Below, the band's sound: each instrument's breath and
 * character (from clean synth to gritty), the drone's voicing and life, and the room.
 */

interface SoundPanelProps {
  settings: ModelSettings;
  onUpdateSettings: (patch: Partial<ModelSettings>) => void;
  /** Fill the panel (in the village) rather than stand as a column of its own. */
  fill?: boolean;
}

const muted: React.CSSProperties = { color: 'var(--text-muted)' };

function pill(active: boolean): React.CSSProperties {
  return active
    ? { backgroundColor: 'var(--bg-linen)', color: 'var(--text-ink)', borderColor: 'color-mix(in srgb, var(--text-ink) 50%, transparent)', fontWeight: 600 }
    : { backgroundColor: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-folk)' };
}

function Slider({ label, value, onChange, hint, left, right }: { label: string; value: number; onChange: (v: number) => void; hint?: string; left?: string; right?: string }) {
  return (
    <label className="block text-[10px]" title={hint}>
      <span className="flex justify-between" style={muted}>
        <span>{label}</span>
        <span>{left && right ? (value < 0.34 ? left : value > 0.66 ? right : 'between') : `${Math.round(value * 100)}`}</span>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="stitch-range w-full" />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md p-2.5" style={{ border: '1px solid var(--border-folk)' }}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={muted}>
        {title}
      </div>
      {children}
    </section>
  );
}

export function SoundPanel({ settings, onUpdateSettings, fill = true }: SoundPanelProps) {
  useSyncExternalStore(subscribeMixer, mixerVersion);
  useSyncExternalStore(villageMusic.subscribe, villageMusic.getVersion);
  const levels = mixerLevels();
  const music = villageMusic.status();
  const tone = villageMusic.tone;
  const mode = currentSoundMode(settings);
  const talk = settings.talkDensity ?? 0.5;
  const scribe = settings.scribeDensity ?? 0.5;
  const level = (ch: MixerChannel) => (v: number) => setLevel(ch, v);

  const rows: Array<{ ch: MixerChannel; name: string; key?: string; amount?: { value: number; set: (v: number) => void; hint: string } }> = [
    { ch: 'voices', name: 'Characters', amount: { value: talk, set: (v) => onUpdateSettings({ talkDensity: v }), hint: 'How much they talk among themselves: 0 and they go about their business' } },
    { ch: 'narrator', name: 'Scribe', amount: { value: scribe, set: (v) => onUpdateSettings({ scribeDensity: v }), hint: 'How much the Scribe tells: lower frames fewer scenes, higher also tells village life; 0 is silent' } },
    { ch: 'music', name: 'Music' },
    { ch: 'guide', name: 'Guide' },
    { ch: 'master', name: 'Everything' },
  ];

  // The music's three parts, each with its own amount (no volume of its own).
  const amounts = villageMusic.amounts;
  const musicParts: typeof rows = [
    { ch: 'music', name: '· ambience', key: 'ambience', amount: { value: amounts.ambience, set: (v) => villageMusic.setAmounts({ ambience: v }), hint: 'The drone and a soft, sparse tapan, always underneath; under speech they play slower and sparser. 0 turns it off' } },
    { ch: 'music', name: '· in-between', key: 'between', amount: { value: amounts.between, set: (v) => villageMusic.setAmounts({ between: v }), hint: 'Motifs around the lines of the story: how soon after a line, how often in a gap, how long they linger. 0 turns them off' } },
    { ch: 'music', name: '· song', key: 'song', amount: { value: amounts.song, set: (v) => villageMusic.setAmounts({ song: v }), hint: 'The band in full while no one speaks: how soon after the story falls quiet, and how long. 0: never' } },
  ];

  const voice = (key: 'gaida' | 'kaval' | 'tapan' | 'drone', name: string, t: VoiceTone, extra?: React.ReactNode) => (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold">{name}</div>
      <div className="grid grid-cols-3 gap-2">
        <Slider label="Level" value={t.level} onChange={(v) => villageMusic.setTone({ [key]: { level: v } })} />
        <Slider label="Breath" hint="Breath, air and noise in the sound" value={t.breath} onChange={(v) => villageMusic.setTone({ [key]: { breath: v } })} />
        <Slider label="Character" hint="From a clean electronic synth to gritty and overdriven" left="synth" right="gritty" value={t.character} onChange={(v) => villageMusic.setTone({ [key]: { character: v } })} />
      </div>
      {extra}
    </div>
  );

  return (
    <aside aria-label="Sound" className={`flex h-full ${fill ? 'w-full' : 'w-[min(92vw,22rem)] border-l border-borderFolk'} shrink-0 flex-col overflow-hidden bg-surface text-ink`}>
      <div className="thin-scroll flex-1 space-y-3.5 overflow-y-auto px-3 py-2.5 text-xs">
        <Section title="Listening">
          <div className="grid grid-cols-3 gap-1">
            {SOUND_MODES.map((m) => (
              <button key={m.id} type="button" title={m.about} aria-pressed={mode?.id === m.id} onClick={() => applySoundMode(m, onUpdateSettings)} className="rounded border px-1.5 py-1 text-[10px]" style={pill(mode?.id === m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[10px]" style={muted}>
            {mode ? mode.about : 'Your own mix.'}
          </div>
          <div className="mt-2">
            <Slider
              label="Story pace"
              hint="The story's tempo: the breath between lines, the rest between conversations, the Scribe's quiet moments. Slow lingers; brisk moves on"
              left="slow"
              right="brisk"
              value={settings.storyPace ?? 0.5}
              onChange={(v) => onUpdateSettings({ storyPace: v })}
            />
          </div>
        </Section>

        <Section title="Mixer">
          <div className="grid grid-cols-[4.5rem_1fr_1fr] items-end gap-x-2 gap-y-1.5">
            <span />
            <span className="text-[10px]" style={muted}>
              Volume
            </span>
            <span className="text-[10px]" style={muted}>
              How much
            </span>
            {rows.flatMap((r) => [r, ...(r.ch === 'music' ? musicParts : [])]).map((r) => (
              <React.Fragment key={r.key ?? r.ch}>
                <span className="pb-0.5 text-[11px]" style={r.key ? muted : undefined}>
                  {r.name}
                </span>
                {r.key ? (
                  <span />
                ) : (
                  <input type="range" min={0} max={1} step={0.01} value={levels[r.ch]} aria-label={`${r.name} volume`} title={`${Math.round(levels[r.ch] * 100)}%`} onChange={(e) => level(r.ch)(Number(e.target.value))} className="stitch-range w-full" />
                )}
                {r.amount ? (
                  <input type="range" min={0} max={1} step={0.01} value={r.amount.value} aria-label={`How much: ${r.name}`} title={`${r.amount.hint} (${Math.round(r.amount.value * 100)})`} onChange={(e) => r.amount!.set(Number(e.target.value))} className="stitch-range w-full" />
                ) : (
                  <span />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={music.on} onChange={(e) => villageMusic.setEnabled(e.target.checked)} />
              <span>Music on</span>
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5" title="The Scribe's model names the mood of the moment when one is loaded; otherwise word lists">
              <input type="checkbox" checked={music.listening === 'scribe'} onChange={(e) => villageMusic.listenWith(e.target.checked ? 'scribe' : 'words')} />
              <span>The Scribe chooses the mood</span>
            </label>
          </div>
          {music.on && (
            <div className="mt-1.5 text-[10px]" style={muted}>
              {music.cue.mood} · {music.intensity.toFixed(2)}
              {music.playing ? ` · ${music.playing}` : ''}
              {music.cue.reason ? ` — ${music.cue.reason}` : ''}
            </div>
          )}
        </Section>

        <Section title="The band">
          <div className="mb-2.5 grid grid-cols-4 gap-1">
            {Object.entries(TONE_PRESETS).map(([id, p]) => (
              <button key={id} type="button" onClick={() => villageMusic.setTone(p.tone)} className="rounded border px-1 py-1 text-[10px]" style={pill(JSON.stringify(p.tone) === JSON.stringify(tone))}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {voice(
              'drone',
              'Gaida drone',
              tone.drone,
              <>
                <div className="grid grid-cols-4 gap-1 pt-0.5">
                  {(['tonic', 'fifth', 'octave', 'open'] as DroneVoicing[]).map((v) => (
                    <button key={v} type="button" title={v === 'open' ? 'Tonic, fifth and octave' : v === 'tonic' ? 'The tonic alone' : `The tonic with the ${v}`} onClick={() => villageMusic.setTone({ drone: { voicing: v } })} className="rounded border px-1 py-0.5 text-[10px]" style={pill(tone.drone.voicing === v)}>
                      {v}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Slider label="Movement" hint="How much the drone's tone drifts and swells on its own" value={tone.drone.movement} onChange={(v) => villageMusic.setTone({ drone: { movement: v } })} />
                  <Slider label="Beating" hint="Beating between the drone's reeds: a slow shimmer" value={tone.drone.beating} onChange={(v) => villageMusic.setTone({ drone: { beating: v } })} />
                </div>
              </>,
            )}
            {voice('gaida', 'Gaida chanter', tone.gaida)}
            {voice('kaval', 'Kaval', tone.kaval)}
            {voice('tapan', 'Tapan', tone.tapan)}
          </div>
        </Section>

        <Section title="Ambience">
          <div className="grid grid-cols-3 gap-2">
            <Slider label="Reverb" hint="How much of the room is heard" value={tone.ambience.reverb} onChange={(v) => villageMusic.setTone({ ambience: { reverb: v } })} />
            <Slider label="Room" hint="From a small house to a mountain gorge" left="house" right="gorge" value={tone.ambience.room} onChange={(v) => villageMusic.setTone({ ambience: { room: v } })} />
            <Slider label="Echo" hint="A tape echo" value={tone.ambience.echo} onChange={(v) => villageMusic.setTone({ ambience: { echo: v } })} />
          </div>
        </Section>
      </div>
    </aside>
  );
}
