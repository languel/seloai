import { MOODS, MOOD_IDS, clamp01, type Mood } from './cue';
import type { StoryLine } from './listener';

/**
 * The Scribe's ear: the storyteller's own model reads the latest moment of the story and says
 * what the band should play, in one short line, e.g. "lament 0.3 — the well is dry and they mourn".
 * The prompt shows only the form, not an example answer, which small models copy word for word.
 * It reads meaning where the listener's word lists only count words: a calm line that hides a
 * threat, a joke at a funeral. Asked rarely and briefly, it never touches the story text or
 * the voice; when no model answers, the word lists carry on alone.
 */

export interface ScribeScore {
  mood: Mood;
  intensity: number;
  reason?: string;
}

const MOOD_HELP: Record<Mood, string> = {
  pastoral: 'calm daily life, work, the land',
  lament: 'grief, loss, hunger, drought',
  mystery: 'magic, night, spirits, the unknown',
  dread: 'a monster, a curse, mortal danger',
  tension: 'a quarrel, a threat, suspense',
  joy: 'warmth, kindness, love, relief',
  festive: 'a dance, a wedding, a feast',
  triumph: 'a victory, a rescue, a curse broken',
};

/** The messages that ask a model for the music of the moment. */
export function scorePrompt(params: {
  lines: StoryLine[];
  narratorName?: string;
  placeName?: string;
  premise?: string;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const narrator = params.narratorName?.trim() || 'Scribe';
  const recent = [...params.lines]
    .sort((a, b) => a.at - b.at)
    .slice(-8)
    .map((l) => `${l.kind === 'narration' ? narrator : (l.speaker ?? 'Someone')}${l.kind === 'thought' ? ' (thinking)' : ''}: ${l.text.replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n');
  return [
    {
      role: 'system',
      content: [
        `You are ${narrator}'s ear for music. A village band (tapan drum, gaida bagpipe, kaval flute) plays under the story${params.placeName ? ` of ${params.placeName}` : ''}. Read the latest moment and choose the music.`,
        'Answer with ONE line only: <mood> <intensity> — <why, in a few of your own words about this moment>',
        `<mood> is one of: ${MOOD_IDS.map((m) => `${m} (${MOOD_HELP[m]})`).join('; ')}.`,
        '<intensity> is 0.0 to 1.0: 0.1 hushed, 0.3 quiet, 0.5 stirring, 0.7 urgent, 0.9 wild.',
        'Judge only the latest moment; most moments are not dangerous.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `${params.premise ? `Situation: ${params.premise}\n` : ''}Latest moment:\n${recent || '(nothing has been said yet)'}\n\nThe music now:`,
    },
  ];
}

/** Words a model may use in place of a mood's name. */
const SYNONYMS: Array<[RegExp, Mood]> = [
  [/\b(calm|peaceful|serene|idyllic|bucolic|quiet)\b/, 'pastoral'],
  [/\b(sad|sorrow\w*|grief|griev\w*|mourn\w*|melanchol\w*|lament\w*)\b/, 'lament'],
  [/\b(myster\w*|magic\w*|eerie|uncanny|mystical|otherworldly)\b/, 'mystery'],
  [/\b(fear\w*|danger\w*|menac\w*|ominous|horror|terror|doom\w*|dark)\b/, 'dread'],
  [/\b(tense|suspense\w*|conflict|anger|angry|argument)\b/, 'tension'],
  [/\b(happy|warm\w*|tender|joyful|cheer\w*)\b/, 'joy'],
  [/\b(celebrat\w*|dance|dancing|wedding|feast\w*|party)\b/, 'festive'],
  [/\b(victor\w*|triumph\w*|heroic|rescue\w*)\b/, 'triumph'],
];

/** Reads a model's answer; null when it names no mood. */
export function parseScore(text: string): ScribeScore | null {
  const t = text.replace(/<think>[\s\S]*?<\/think>/gi, ' ').toLowerCase();
  let mood: Mood | null = null;
  let at = Infinity;
  for (const m of MOOD_IDS) {
    const i = t.search(new RegExp(`\\b${m}\\b`));
    if (i >= 0 && i < at) {
      mood = m;
      at = i;
    }
  }
  if (!mood) for (const [re, m] of SYNONYMS) if (re.test(t)) {
    mood = m;
    break;
  }
  if (!mood) return null;
  const num = /(\d*\.\d+|\d+)(\s*%)?/.exec(t);
  let intensity = MOODS[mood].base;
  if (num) {
    let n = Number(num[1]);
    if (num[2] || n > 10) n /= 100;
    else if (n > 1) n /= 10;
    intensity = clamp01(n);
  }
  const why = /[—–:-]\s*([^\n]{3,})/.exec(text.replace(/<think>[\s\S]*?<\/think>/gi, ' '));
  const reason = why?.[1].trim().replace(/^["'“]|["'”.]$/g, '').slice(0, 80);
  // A model that echoes the form instead of answering gives no reason.
  const own = reason && !/^</.test(reason) ? reason : undefined;
  return { mood, intensity, ...(own ? { reason: own } : {}) };
}

/** Asked at most this often, in seconds, so the story's own lines keep the model's time. */
export const SCORE_EVERY = 40;
/** A reading older than this gives way to the word lists. */
export const SCORE_STALE = 150;

/**
 * When to ask the Scribe and how to weigh its answer. It asks after new narration, or after a
 * few new lines, never more than once every `SCORE_EVERY` seconds and never twice at once.
 * Its mood leads; its intensity is blended with the listener's, which also hears how busy the
 * scene is. Pure apart from its own memory.
 */
export class ScribeEar {
  private inflight = false;
  private lastAsk = -Infinity;
  private reading: (ScribeScore & { at: number }) | null = null;

  /** Whether the moment has changed enough to ask again. */
  shouldAsk(lines: StoryLine[], now: number): boolean {
    if (this.inflight || now - this.lastAsk < SCORE_EVERY) return false;
    const fresh = lines.filter((l) => l.at > this.lastAsk);
    return fresh.some((l) => l.kind === 'narration') || fresh.length >= 3 || (this.lastAsk === -Infinity && fresh.length > 0);
  }

  /** Asks, once; the answer (or null) is kept and passed on. */
  async ask(now: number, scorer: () => Promise<ScribeScore | null>): Promise<ScribeScore | null> {
    this.inflight = true;
    this.lastAsk = now;
    try {
      const score = await scorer();
      if (score) this.reading = { ...score, at: now };
      return score;
    } catch {
      return null;
    } finally {
      this.inflight = false;
    }
  }

  /** The Scribe's reading, while it is fresh. */
  current(now: number) {
    return this.reading && now - this.reading.at < SCORE_STALE ? this.reading : null;
  }

  /** The listener's cue, led by the Scribe's reading while it is fresh. */
  blend<C extends { mood: Mood; intensity: number; reason?: string }>(heard: C, now: number): C {
    const r = this.current(now);
    if (!r) return heard;
    return {
      ...heard,
      mood: r.mood,
      intensity: Math.round(clamp01(0.65 * r.intensity + 0.35 * heard.intensity) * 100) / 100,
      reason: `the Scribe hears ${r.mood}${r.reason ? `: ${r.reason}` : ''}`,
    };
  }

  reset() {
    this.reading = null;
    this.lastAsk = -Infinity;
  }
}
