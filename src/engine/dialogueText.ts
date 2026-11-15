/** Pure text helpers for dialogue: similarity checks and parsing model output into speech, narration and thought. */

export interface ParsedDialogue {
  spoken: string;
  narration: string[];
  thoughts: string[];
  reasoning: string[];
  display: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Detects whether a candidate motive, narration beat, or spoken line is a near-duplicate
 * of recent text so LLM/story-sim characters cannot get stuck repeating the same phrase.
 */
export function isTextTooSimilar(
  candidate: string,
  recentList: string[],
  threshold = 0.55,
): boolean {
  const cleanCand = candidate.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleanCand) return false;
  const candTokens = normalizeTokens(cleanCand);
  const candSet = new Set(candTokens);

  for (const prevRaw of recentList) {
    const prev = prevRaw?.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!prev) continue;
    if (cleanCand === prev) return true;
    if (cleanCand.length >= 16 && prev.length >= 16 && (prev.includes(cleanCand) || cleanCand.includes(prev))) {
      return true;
    }
    const prevTokens = normalizeTokens(prev);
    if (candTokens.length === 0 || prevTokens.length === 0) continue;
    const prevSet = new Set(prevTokens);
    let intersection = 0;
    for (const t of candSet) {
      if (prevSet.has(t)) intersection++;
    }
    const union = candSet.size + prevSet.size - intersection;
    if (union > 0 && intersection / union >= threshold) {
      return true;
    }
    // Catch repeated 3+ word lead-in stems like "chase the brass key..."
    if (
      candTokens.length >= 4 &&
      prevTokens.length >= 4 &&
      candTokens.slice(0, 3).join(' ') === prevTokens.slice(0, 3).join(' ')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Separates LLM meta <think>...</think> reasoning, optional <thought>...</thought>
 * inner monologue, inline narrative actions (*looks out*, [waves]), and pure
 * spoken dialogue without accidental self-name prefixes ("Olena: Hello").
 */
export function parseDialogueAndNarration(
  rawText: string,
  speakerName?: string,
): ParsedDialogue {
  const reasoning: string[] = [];
  const thoughts: string[] = [];

  let cleaned = (rawText ?? '')
    .replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, (_full, body) => {
      const trace = String(body ?? '').trim();
      if (trace) reasoning.push(trace);
      return '';
    })
    .replace(/<thought>([\s\S]*?)(?:<\/thought>|$)/gi, (_full, body) => {
      const inner = String(body ?? '').trim();
      if (inner) thoughts.push(inner);
      return '';
    })
    .trim();

  const candidateNames = new Set<string>(['assistant', 'npc', 'villager']);
  if (speakerName?.trim()) {
    const trimmed = speakerName.trim();
    candidateNames.add(trimmed);
    const firstWord = trimmed.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 2) {
      candidateNames.add(firstWord);
    }
  }
  const namesPattern = Array.from(candidateNames).map(escapeRegExp).join('|');
  const prefixRegex = new RegExp(
    `^(?:\\*\\*|__)?\\[?(?:${namesPattern})\\]?(?:\\*\\*|__)?\\s*(?:says\\s*)?[:\\-—]\\s*`,
    'i',
  );

  for (let i = 0; i < 3; i += 1) {
    const next = cleaned.replace(prefixRegex, '').trim();
    if (next === cleaned) break;
    cleaned = next;
  }

  // Unwrap balanced outer quotes if prefix removal left a single quoted speech string
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith('“') && cleaned.endsWith('”'))
  ) {
    const inner = cleaned.slice(1, -1).trim();
    if (inner.length > 0 && !inner.slice(0, -1).includes('"')) {
      cleaned = inner;
    }
  }

  const narration: string[] = [];
  const spoken = cleaned
    .replace(/(?:\*([^*\n]{2,120})\*|\[([^\]\n]{2,120})\])/g, (_full, starBody, bracketBody) => {
      const note = String(starBody ?? bracketBody ?? '').trim();
      if (note) {
        narration.push(note.charAt(0).toUpperCase() + note.slice(1));
      }
      return ' ';
    })
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(prefixRegex, '')
    .trim();

  return {
    spoken,
    narration,
    thoughts,
    reasoning,
    display: spoken || narration.join(' ') || thoughts.join(' ') || cleaned,
  };
}
