import type { PointOfInterest } from '../engine/types';

export interface RichTextSegment {
  text: string;
  kind: 'plain' | 'poi' | 'actor';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert PascalCase/camelCase or snake/kebab POI tags (e.g. `KukeriHearth`) into spaced words. */
export function humanizeTag(tag: string): string {
  const spaced = tag
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return spaced || tag;
}

/**
 * Abbreviate a multi-word character name cleanly (e.g. `Lamia Zmeitsa` -> `Lamia Z.`)
 * when rendered in compact pills or tight badges.
 */
export function abbreviatePersonName(name: string, maxLen = 12): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length <= maxLen) return trimmed;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0];
    const lastInitial = `${parts[parts.length - 1][0]}.`;
    const combined = `${first} ${lastInitial}`;
    if (combined.length <= maxLen) return combined;
    if (first.length <= maxLen) return first;
  }
  return `${trimmed.slice(0, Math.max(2, maxLen - 1)).trimEnd()}…`;
}

/**
 * Abbreviate a world title cleanly for compact header selectors (e.g. stripping
 * subtitles after `: ` when too wide instead of awkward mid-word wrapping).
 */
export function abbreviateWorldName(name: string, maxLen = 20): string {
  let clean = name
    .replace(/^World:\s*/i, '')
    .replace(/\s*\(Placeholder\)\s*$/i, '')
    .trim();
  if (!clean) return 'Village';

  if (clean.startsWith('Auto-Backup:')) {
    const rest = clean.slice('Auto-Backup:'.length).trim();
    const budget = Math.max(8, maxLen - 8);
    return `Backup: ${abbreviateWorldName(rest, budget)}`;
  }

  if (clean.length <= maxLen) return clean;

  const colonIdx = clean.indexOf(':');
  if (colonIdx >= 3) {
    const primary = clean.slice(0, colonIdx).trim();
    if (primary.length <= maxLen) {
      return primary;
    }
    clean = primary;
  }

  const words = clean.split(/\s+/);
  let acc = '';
  for (const w of words) {
    const next = acc ? `${acc} ${w}` : w;
    if (next.length + 1 > maxLen) break;
    acc = next;
  }
  if (acc.length >= 3) return `${acc}…`;
  return `${clean.slice(0, Math.max(2, maxLen - 1)).trimEnd()}…`;
}

/**
 * Resolve `#Tag`, `#Tag (Label)`, exact POI titles, and `@Actor` mentions into
 * display segments without raw `#` or `@` punctuation.
 */
export function tokenizeRichText(
  text: string,
  pois: PointOfInterest[] = [],
  actorNames: string[] = [],
): RichTextSegment[] {
  if (!text) return [];

  const poiByTag = new Map<string, PointOfInterest>();
  const poiByLabelLower = new Map<string, PointOfInterest>();
  for (const p of pois) {
    if (p.tag) poiByTag.set(p.tag.toLowerCase(), p);
    if (p.label) poiByLabelLower.set(p.label.toLowerCase(), p);
  }

  const sortedPoiLabels = pois
    .map((p) => p.label?.trim())
    .filter((l): l is string => Boolean(l && l.length >= 4))
    .sort((a, b) => b.length - a.length);

  const actorByLower = new Map<string, string>();
  for (const a of actorNames) {
    const t = a.trim();
    if (t) actorByLower.set(t.toLowerCase(), t);
  }
  const sortedActors = [...actorByLower.values()].sort((a, b) => b.length - a.length);

  const parts: string[] = ['(#([a-z0-9_-]+)(?:\\s*\\(([^)]+)\\))?)'];
  if (sortedActors.length > 0) {
    parts.push(`(@(?:${sortedActors.map(escapeRegExp).join('|')})(?=$|[\\s.,!?;:'"’”\\)\\]]))`);
  }
  if (sortedPoiLabels.length > 0) {
    parts.push(
      `([\\s("“'’]?)(${sortedPoiLabels.map(escapeRegExp).join('|')})(?=$|[\\s.,!?;:'"’”\\)\\]])`,
    );
  }

  const pattern = new RegExp(parts.join('|'), 'gi');
  const segments: RichTextSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), kind: 'plain' });
    }

    if (match[1]) {
      const tag = match[2] ?? '';
      const parenLabel = match[3]?.trim();
      const poi = poiByTag.get(tag.toLowerCase());
      const resolvedLabel = poi?.label || parenLabel || humanizeTag(tag);
      segments.push({ text: resolvedLabel, kind: 'poi' });
    } else if (match[4]) {
      const rawName = match[4].slice(1);
      const canonical = actorByLower.get(rawName.toLowerCase()) ?? rawName;
      segments.push({ text: canonical, kind: 'actor' });
    } else if (match[6]) {
      const leadSep = match[5] ?? '';
      if (leadSep) {
        segments.push({ text: leadSep, kind: 'plain' });
      }
      const poi = poiByLabelLower.get(match[6].toLowerCase());
      segments.push({ text: poi?.label || match[6], kind: 'poi' });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), kind: 'plain' });
  }

  return segments.length > 0 ? segments : [{ text, kind: 'plain' }];
}

/** Convenience plain-string formatter that expands `#Tag` / `#Tag (Label)` to readable object titles. */
export function formatRichPlainText(
  text: string,
  pois: PointOfInterest[] = [],
  actorNames: string[] = [],
): string {
  return tokenizeRichText(text, pois, actorNames)
    .map((s) => s.text)
    .join('');
}
