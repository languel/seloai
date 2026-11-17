/**
 * The two members of the cast who are not villagers: the Scribe (the narrator) and the
 * Traveler (the player). Both live in the model settings rather than the roster, but are
 * edited here beside the villagers: name, voice and what they do.
 */
import { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { brainRouter } from '../ai/brainRouter';
import { DEFAULT_MODEL_SETTINGS, OMNI_SPEECH_LANGUAGES, buildNarratorConfig, buildTravelerConfig } from '../data/defaultData';
import type { ModelSettings, VillagerVoiceProfile, VoiceGender } from '../engine/types';
import { FigureAppearance } from './FigureAppearance';
import { figureBuildFor, type WorldLook } from '../art/gameLook';
import type { FigureKind } from '../art/figures';
import { TTS_TEMPLATE_DEFAULT, ttsInstruction } from '../ai/voiceAccent';

export type CastMember = 'scribe' | 'traveler';

export const CAST_IDS: Record<CastMember, string> = { scribe: '__cast-scribe', traveler: '__cast-traveler' };

interface CastPanelProps {
  member: CastMember;
  settings: ModelSettings;
  onUpdateSettings: (patch: Partial<ModelSettings>) => void;
  /** The world look, so the Traveler's figure is previewed as the village draws it. */
  worldLook?: WorldLook;
}

const field = 'w-full rounded border border-borderFolk bg-surface px-2.5 py-1.5 text-xs';

export function CastPanel({ member, settings, onUpdateSettings, worldLook = 'tiles' }: CastPanelProps) {
  const [testing, setTesting] = useState(false);
  const scribe = member === 'scribe';
  const voiceKey = scribe ? 'narratorVoice' : 'playerVoice';
  const voice: VillagerVoiceProfile = { ...DEFAULT_MODEL_SETTINGS[voiceKey], ...(settings[voiceKey] ?? {}) };
  const setVoice = (patch: Partial<VillagerVoiceProfile>) => onUpdateSettings({ [voiceKey]: { ...voice, ...patch } });
  const cfg = scribe ? buildNarratorConfig(settings) : buildTravelerConfig(settings);
  const worldLanguage = settings.worldLanguage?.trim() || 'English';

  const test = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const sample = scribe
        ? `And so the evening settled over the village, and ${cfg.name} took up the thread of the tale.`
        : `Good evening. I am ${cfg.name}, and I have come a long way to see this place.`;
      await brainRouter.speakLine(sample, cfg, settings, undefined, { preview: true });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="border-b border-borderFolk pb-3">
        <h1 className="text-lg font-bold">{scribe ? 'The Scribe' : 'The Traveler'}</h1>
        <p className="text-xs text-muted">
          {scribe
            ? 'The voice that tells the story: it narrates scene beats and answers when addressed with @Scribe.'
            : 'You, as the village sees you: your figure, name and voice.'}
        </p>
      </div>

      {!scribe && (
        <div className="rushnyk-card rounded-sm p-2.5 space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">The figure</h2>
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            {(
              [
                [undefined, 'Auto'],
                ['skirted', 'Skirted'],
                ['trousered', 'Trousered'],
              ] as const
            ).map(([build, label]) => {
              const on = settings.playerFigure?.build === build;
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  title={build ? `Draw as ${label.toLowerCase()}` : 'Decide from the voice'}
                  onClick={() => onUpdateSettings({ playerFigure: { ...settings.playerFigure, build } })}
                  className={`rounded px-2 py-0.5 glyph-button ${on ? 'glyph-on font-semibold' : ''}`}
                >
                  {label}
                  {!build && on ? ` (${figureBuildFor({ ...cfg, figure: { kind: cfg.figure?.kind } })})` : ''}
                </button>
              );
            })}
            <label className="ml-3 inline-flex items-center gap-1">
              <span className="text-muted">Kind</span>
              <select
                value={settings.playerFigure?.kind ?? 'human'}
                onChange={(e) =>
                  onUpdateSettings({
                    playerFigure: { ...settings.playerFigure, kind: e.target.value === 'human' ? undefined : (e.target.value as FigureKind) },
                  })
                }
                className="rounded border border-borderFolk bg-surface px-1 py-0.5 text-[11px]"
              >
                <option value="human">Villager</option>
                <option value="serpent">Serpent (lamia)</option>
                <option value="kuker">Kuker mummer</option>
                <option value="samodiva">Samodiva</option>
              </select>
            </label>
          </div>
          {worldLook !== 'tiles' ? (
            <FigureAppearance villager={cfg} look={worldLook} onChange={(figure) => onUpdateSettings({ playerFigure: figure })} />
          ) : (
            <p className="text-[11px] text-muted">The figure shows in the stitched looks; Classic tiles draws the old pixel Traveler.</p>
          )}
        </div>
      )}

      <div className="rushnyk-card rounded-sm p-2.5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`cast-name-${member}`} className="block text-xs font-medium mb-1">Name</label>
            <input
              id={`cast-name-${member}`}
              value={scribe ? settings.narratorName : (settings.playerName ?? '')}
              placeholder={scribe ? 'Scribe' : 'The world’s name for you (Traveler)'}
              onChange={(e) => onUpdateSettings(scribe ? { narratorName: e.target.value } : { playerName: e.target.value })}
              className={field}
            />
          </div>
          {scribe ? (
            <div>
              <label htmlFor="cast-style" className="block text-xs font-medium mb-1">Storytelling style</label>
              <select
                id="cast-style"
                value={settings.narratorStyle}
                onChange={(e) => onUpdateSettings({ narratorStyle: e.target.value as ModelSettings['narratorStyle'] })}
                className={field}
              >
                <option value="dungeon-master">Dungeon master</option>
                <option value="storybook">Storybook</option>
                <option value="chronicler">Chronicler</option>
              </select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {scribe ? (
            <>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={settings.narratorEnabled} onChange={(e) => onUpdateSettings({ narratorEnabled: e.target.checked })} />
                <span>Narrates the story</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={settings.narrateEvents} onChange={(e) => onUpdateSettings({ narrateEvents: e.target.checked })} />
                <span>Tells world events</span>
              </label>
            </>
          ) : (
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={Boolean(settings.speakPlayerLines)} onChange={(e) => onUpdateSettings({ speakPlayerLines: e.target.checked })} />
              <span>Speak my typed lines aloud</span>
            </label>
          )}
        </div>
      </div>

      <div className="rushnyk-card rounded-sm p-2.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Voice</h2>
          <button
            type="button"
            onClick={test}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded bg-indigoFolk px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
          >
            <Volume2 className="h-3.5 w-3.5" />
            <span>{testing ? 'Speaking…' : 'Test Voice'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium">Voice</legend>
            <div className="flex items-center gap-2.5 text-xs pt-1">
              {(['female', 'male'] as VoiceGender[]).map((g) => (
                <label key={g} className="inline-flex items-center gap-1.5 cursor-pointer capitalize">
                  <input type="radio" name={`cast-gender-${member}`} checked={voice.gender === g} onChange={() => setVoice({ gender: g })} />
                  <span>{g}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`cast-accent-${member}`} className="block text-xs font-medium mb-1">Locale</label>
            <select id={`cast-accent-${member}`} value={voice.language} onChange={(e) => setVoice({ language: e.target.value })} className={field}>
              {OMNI_SPEECH_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`cast-world-language-${member}`} className="block text-xs font-medium mb-1" title="The language characters write their lines in. Shared by everyone; the voice instruction can use it as {world}.">
              World language
            </label>
            <input
              id={`cast-world-language-${member}`}
              value={settings.worldLanguage ?? ''}
              placeholder="English"
              onChange={(e) => onUpdateSettings({ worldLanguage: e.target.value })}
              className={field}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor={`cast-tts-template-${member}`} className="text-xs font-medium" title="Shared by every voice. {locale}, {world} and {gender} are filled in per speaker.">
              Voice instruction
            </label>
            {settings.ttsInstructionTemplate?.trim() ? (
              <button type="button" onClick={() => onUpdateSettings({ ttsInstructionTemplate: '' })} className="text-[11px] text-muted underline hover:text-ink">
                Reset to default
              </button>
            ) : null}
          </div>
          <textarea
            id={`cast-tts-template-${member}`}
            rows={2}
            value={settings.ttsInstructionTemplate?.trim() ? settings.ttsInstructionTemplate : TTS_TEMPLATE_DEFAULT}
            onChange={(e) => onUpdateSettings({ ttsInstructionTemplate: e.target.value })}
            className={`${field} font-mono`}
          />
          <p className="mt-1 text-[11px] text-muted">
            Sent for this voice: <span className="font-mono">{ttsInstruction(voice.language, worldLanguage, voice.gender, settings.ttsInstructionTemplate)}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {(
            [
              ['pitchSemitones', 'Pitch', -6, 6, 0.5, (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} st`],
              ['speakingRate', 'Rate', 0.8, 1.25, 0.02, (v: number) => `${v.toFixed(2)}×`],
              ['warmthDb', 'Warmth', -6, 6, 0.5, (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`],
            ] as const
          ).map(([key, label, min, max, step, show]) => (
            <div key={key}>
              <label htmlFor={`cast-${key}-${member}`} className="flex justify-between font-medium mb-1">
                <span>{label}</span>
                <span className="font-mono text-muted">{show(voice[key])}</span>
              </label>
              <input
                id={`cast-${key}-${member}`}
                type="range"
                min={min}
                max={max}
                step={step}
                value={voice[key]}
                onChange={(e) => setVoice({ [key]: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
