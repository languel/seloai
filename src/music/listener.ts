import { MOODS, MOOD_IDS, clamp01, type Mood, type MusicCue } from './cue';

/**
 * The musicians' ear: it listens to the story the way the Scribe does and decides what the
 * music should feel like. Recent lines are weighed (narration more than speech, thoughts
 * less, and everything fading over a minute or so); words that belong to a mood vote for it;
 * how much is happening (conversations, people speaking, exclamations, dancing) sets how
 * hard the band plays. The mood changes only when another one clearly wins and the current
 * one has had its moment, so the music does not flicker with every line.
 *
 * Pure apart from its own memory: the same readings at the same times give the same cues.
 */

export interface StoryLine {
  text: string;
  kind?: 'speech' | 'narration' | 'thought';
  /** Who said it (for the Scribe's ear). */
  speaker?: string;
  /** Seconds, on the same clock as `SceneReading.now`. */
  at: number;
}

export interface SceneReading {
  /** Seconds. */
  now: number;
  /** Recent lines of the story, any order. */
  lines: StoryLine[];
  activeConversations?: number;
  /** People speaking right now. */
  speaking?: number;
  /** People dancing (a khoro, a wedding). */
  dancing?: number;
  /** A setting-wide hint, e.g. a world premise, weighed lightly. */
  backdrop?: string;
}

/** Words that vote for a mood: stems matched at the start of a word, or a whole word when marked `$`. */
const LEXICON: Record<Mood, readonly string[]> = {
  pastoral: ['sheep', 'flock', 'field', 'meadow', 'morning', 'dawn', 'sun$', 'bread', 'garden', 'wool', 'spin', 'river', 'shepherd', 'harvest', 'goat', 'milk', 'path$', 'hill', 'quiet', 'calm', 'rest$', 'weav', 'loom', 'work'],
  lament: ['dry', 'drought', 'thirst', 'grief', 'griev', 'mourn', 'weep', 'wept', 'tear$', 'lost', 'alone', 'sorrow', 'grave', 'widow', 'orphan', 'miss$', 'gone', 'sad', 'pain', 'empty', 'hunger', 'cry$', 'farewell', 'die$', 'dying', 'buried'],
  mystery: ['samodiv', 'spirit', 'dream', 'moon', 'secret', 'forest', 'strange', 'whisper', 'magic', 'spell', 'herb', 'mist', 'fog', 'vision', 'omen', 'riddle', 'hidden', 'ancient', 'wonder', 'star$', 'stars$', 'night', 'shadow', 'cave', 'fairy', 'nymph', 'song'],
  dread: ['curse', 'lamia', 'serpent', 'zmey', 'dragon', 'blood', 'death', 'dead', 'dark', 'fear', 'afraid', 'beware', 'sacrific', 'demon', 'devil', 'witch', 'monster', 'beast', 'kill', 'devour', 'poison', 'doom', 'terror', 'scream', 'vampir', 'plague', 'coils', 'fang'],
  tension: ['no$', 'never', 'demand', 'angry', 'anger', 'fight', 'steal', 'stole', 'thief', 'lie$', 'liar', 'lied', 'why$', 'must', 'warn', 'run$', 'hurry', 'quick', 'threat', 'quarrel', 'accus', 'enough', 'stop', 'danger', 'trouble', 'secret', 'betray', 'chase', 'refuse'],
  joy: ['laugh', 'good', 'friend', 'welcome', 'thank', 'love', 'sweet', 'honey', 'bless', 'joy', 'glad', 'happy', 'smile', 'kiss', 'hope', 'gift', 'beautiful', 'kind$', 'warm', 'yes$'],
  festive: ['wedding', 'dance', 'danc', 'horo', 'khoro', 'feast', 'festival', 'rain', 'music', 'sing', 'celebrat', 'kuker', 'drum', 'gaida', 'kaval', 'wine', 'rakia', 'bride', 'groom', 'fair$', 'holiday', 'cheer', 'toast'],
  triumph: ['saved', 'save', 'victory', 'defeat', 'free', 'freed', 'return', 'flows again', 'brims', 'won$', 'win$', 'hero', 'rescued', 'banish', 'vanquish', 'at last', 'restored', 'released'],
};

const WORD_RES: Record<Mood, RegExp> = Object.fromEntries(
  MOOD_IDS.map((m) => [
    m,
    new RegExp(`\\b(?:${LEXICON[m].map((w) => (w.endsWith('$') ? `${w.slice(0, -1)}\\b` : `${w}\\w*`).replace(/ /g, '\\s+')).join('|')})`, 'gi'),
  ]),
) as Record<Mood, RegExp>;

const AROUSING: ReadonlySet<Mood> = new Set(['dread', 'tension', 'festive', 'triumph']);

/** How long a line keeps its weight, in seconds (e-folding). */
const MEMORY = 45;
/** A mood holds at least this long before another may take over. */
const MIN_MOOD_HOLD = 14;

export interface MoodVotes {
  scores: Record<Mood, number>;
  words: Partial<Record<Mood, string[]>>;
}

/** Counts each mood's words in a text. */
export function moodVotes(text: string): MoodVotes {
  const scores = Object.fromEntries(MOOD_IDS.map((m) => [m, 0])) as Record<Mood, number>;
  const words: Partial<Record<Mood, string[]>> = {};
  for (const m of MOOD_IDS) {
    const hits = text.match(WORD_RES[m]);
    if (!hits) continue;
    scores[m] += hits.length;
    words[m] = hits.map((h) => h.toLowerCase());
  }
  return { scores, words };
}

export class MusicListener {
  private mood: Mood = 'pastoral';
  private moodSince = -Infinity;
  private intensity = MOODS.pastoral.base;
  private lastAt = -Infinity;

  /** Reads the scene and gives the cue for it. */
  read(r: SceneReading): MusicCue {
    const scores = Object.fromEntries(MOOD_IDS.map((m) => [m, 0])) as Record<Mood, number>;
    const evidence = new Map<string, number>();
    let arousal = 0;
    let recent = 0;
    let newest = -Infinity;

    scores.pastoral += 0.35; // with nothing said, the village is at peace
    if (r.backdrop) {
      const v = moodVotes(r.backdrop);
      for (const m of MOOD_IDS) scores[m] += v.scores[m] * 0.12;
    }

    for (const line of r.lines) {
      const age = r.now - line.at;
      if (age < 0 || age > MEMORY * 4) continue;
      newest = Math.max(newest, line.at);
      const fade = Math.exp(-age / MEMORY);
      const weight = fade * (line.kind === 'narration' ? 1.6 : line.kind === 'thought' ? 0.6 : 1);
      const v = moodVotes(line.text);
      for (const m of MOOD_IDS) {
        if (!v.scores[m]) continue;
        scores[m] += v.scores[m] * weight;
        for (const w of v.words[m] ?? []) evidence.set(`${m}:${w}`, (evidence.get(`${m}:${w}`) ?? 0) + weight);
      }
      const t = line.text.trim();
      const bangs = (t.match(/!/g) ?? []).length;
      arousal += weight * (Math.min(bangs, 3) * 0.18 + (t.length > 110 ? 0.1 : 0) + (/[A-Z]{4,}/.test(t) ? 0.15 : 0));
      if (age < 30) recent++;
    }
    // Two or more dancing is a khoro; one person on the dancing ground is not.
    const dancing = (r.dancing ?? 0) >= 2 ? r.dancing! : 0;
    if (dancing) scores.festive += 1.5 + dancing * 0.4;

    // The mood: the leader, if it clearly beats the current one and the current one has had its time.
    let best: Mood = this.mood;
    for (const m of MOOD_IDS) if (scores[m] > scores[best]) best = m;
    const held = r.now - this.moodSince;
    if (best !== this.mood && scores[best] > scores[this.mood] * 1.25 + 0.25 && held >= MIN_MOOD_HOLD) {
      this.mood = best;
      this.moodSince = r.now;
    } else if (this.moodSince === -Infinity) {
      this.moodSince = r.now;
    }
    const mood = this.mood;

    // The intensity: where the mood sits, pushed up by what is happening, settling when it is quiet.
    if (newest > this.lastAt) this.lastAt = newest;
    const quiet = Number.isFinite(this.lastAt) ? r.now - this.lastAt : Infinity;
    const activity =
      (r.activeConversations ?? 0) * 0.06 + (r.speaking ?? 0) * 0.05 + Math.min(recent, 8) * 0.03 + (dancing ? 0.25 : 0);
    const arousing = AROUSING.has(mood) ? Math.min(0.2, scores[mood] * 0.04) : 0;
    let target = MOODS[mood].base + Math.min(0.3, arousal) + Math.min(0.3, activity) + arousing;
    if (quiet > 40) target = Math.min(target, MOODS[mood].base * 0.6 + 0.04);
    target = clamp01(target);
    // Eased here too, so a burst of lines swells rather than jumps.
    this.intensity += (target - this.intensity) * 0.35;

    const top = [...evidence.entries()]
      .filter(([k]) => k.startsWith(`${mood}:`))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => k.split(':')[1]);
    const reason = top.length
      ? `${mood}: heard ${top.map((w) => `"${w}"`).join(', ')}`
      : dancing
        ? `${mood}: people are dancing`
        : quiet === Infinity
          ? `${mood}: nothing said yet`
          : `${mood}: ${quiet > 40 ? 'the scene has gone quiet' : 'holding the mood'}`;

    return { mood, intensity: Math.round(this.intensity * 100) / 100, reason };
  }

  /** Takes a mood decided elsewhere (the Scribe's ear), so the word lists carry on from it. */
  adopt(mood: Mood, now: number) {
    if (mood !== this.mood) {
      this.mood = mood;
      this.moodSince = now;
    }
  }

  reset() {
    this.mood = 'pastoral';
    this.moodSince = -Infinity;
    this.intensity = MOODS.pastoral.base;
    this.lastAt = -Infinity;
  }
}
