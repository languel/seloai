import type { VillageSimulation } from './simulation';
import type { VillagerConfig } from './types';

export type WorldRecordKind =
  | 'speech'
  | 'narration'
  | 'thought'
  | 'reasoning'
  | 'observation'
  | 'conversation'
  | 'reflection';

export interface WorldInteractionRecord {
  id: string;
  timestamp: number;
  sourceType: 'conversation' | 'memory';
  kind: WorldRecordKind;
  actorId: string;
  actorName: string;
  partnerIds: string[];
  partnerNames: string[];
  locationLabel: string;
  text: string;
  importance?: number;
  conversationId?: string;
}

export interface WorldQueryResult {
  query: string;
  subjectVillager?: VillagerConfig;
  timeWindowLabel: string;
  topicKeywords: string[];
  partners: Array<{
    id: string;
    name: string;
    turnCount: number;
    lastTimestamp: number;
  }>;
  matchingRecords: WorldInteractionRecord[];
  answerSummary: string;
}

const STOPWORDS = new Set([
  'who',
  'what',
  'where',
  'when',
  'why',
  'how',
  'has',
  'have',
  'had',
  'did',
  'does',
  'do',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'talk',
  'talked',
  'talking',
  'speak',
  'spoke',
  'spoken',
  'with',
  'to',
  'from',
  'in',
  'on',
  'at',
  'by',
  'for',
  'of',
  'the',
  'a',
  'an',
  'and',
  'or',
  'about',
  'they',
  'them',
  'their',
  'think',
  'thinks',
  'thought',
  'thoughts',
  'feel',
  'feels',
  'past',
  'last',
  'recent',
  'recently',
  'day',
  'days',
  'hour',
  'hours',
  'today',
  'yesterday',
  'all',
  'any',
  'show',
  'find',
  'list',
]);

/** The tone of some lines: warm, tense, curious, or neither. */
export function inferSentiment(texts: string[]): 'warm' | 'tense' | 'curious' | 'neutral' {
  const joined = texts.join(' ').toLowerCase();
  if (/\b(danger|worry|fear|steal|argument|angry|suspicio|lock|secret|missing|broke)\b/.test(joined)) {
    return 'tense';
  }
  if (/\b(wonder|curious|star|mystery|artifact|investigat|study|inspect|question)\b/.test(joined)) {
    return 'curious';
  }
  if (/\b(warm|friend|smile|thank|share|laugh|tea|bread|help|kind|welcome|song)\b/.test(joined)) {
    return 'warm';
  }
  return 'neutral';
}

function getLandmarkLabel(sim: VillageSimulation, x: number, y: number): string {
  const pois = sim.map.pointsOfInterest ?? [];
  let bestLabel = 'Village';
  let bestDist = Infinity;
  for (const p of pois) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      bestDist = d;
      bestLabel = p.label || p.tag;
    }
  }
  for (const sp of sim.map.spawnPoints) {
    const d = Math.hypot(sp.x - x, sp.y - y);
    if (d < bestDist) {
      bestDist = d;
      bestLabel = sp.label;
    }
  }
  return bestLabel;
}

export function buildWorldDatabase(sim: VillageSimulation): WorldInteractionRecord[] {
  const records: WorldInteractionRecord[] = [];
  const nameById = new Map<string, string>();
  nameById.set(sim.player.id, sim.player.name);
  nameById.set('narrator', sim.modelSettings.narratorName || 'Scribe');
  for (const cfg of sim.configs.values()) {
    nameById.set(cfg.id, cfg.name);
  }

  for (const conv of sim.conversations) {
    const participants = conv.participantIds;
    for (const msg of conv.messages) {
      const actorRt = sim.runtimes.get(msg.senderId);
      const loc = actorRt
        ? getLandmarkLabel(sim, actorRt.x, actorRt.y)
        : msg.senderId === sim.player.id
          ? getLandmarkLabel(sim, sim.player.x, sim.player.y)
          : 'Village';
      const partnerIds = participants.filter((id) => id !== msg.senderId);
      records.push({
        id: `conv-${conv.id}-${msg.id}`,
        timestamp: msg.timestamp,
        sourceType: 'conversation',
        kind: msg.kind ?? (msg.senderId === 'narrator' ? 'narration' : 'speech'),
        actorId: msg.senderId,
        actorName: msg.senderName,
        partnerIds,
        partnerNames: partnerIds.map((id) => nameById.get(id) ?? id),
        locationLabel: loc,
        text: msg.text,
        conversationId: conv.id,
      });
    }
  }

  for (const [id, rt] of sim.runtimes.entries()) {
    const cfg = sim.configs.get(id);
    if (!cfg) continue;
    const loc = getLandmarkLabel(sim, rt.x, rt.y);
    for (const mem of rt.memories) {
      records.push({
        id: `mem-${cfg.id}-${mem.id}`,
        timestamp: mem.timestamp,
        sourceType: 'memory',
        kind: mem.kind,
        actorId: cfg.id,
        actorName: cfg.name,
        partnerIds: [],
        partnerNames: [],
        locationLabel: loc,
        text: mem.summary,
        importance: mem.importance,
      });
    }
  }

  return records.sort((a, b) => b.timestamp - a.timestamp);
}

export function queryWorldDatabase(
  sim: VillageSimulation,
  rawQuery: string,
  now = Date.now(),
): WorldQueryResult {
  const query = rawQuery.trim();
  const lower = query.toLowerCase();
  const records = buildWorldDatabase(sim);

  // 1. Detect time window
  let timeWindowMs = Infinity;
  let timeWindowLabel = 'All recorded time';
  if (/\b(past|last)\s+hour\b|\b1h\b/.test(lower)) {
    timeWindowMs = 60 * 60 * 1000;
    timeWindowLabel = 'Past hour';
  } else if (/\b(past|last)\s+(day|24\s*h|24\s*hours)\b|\btoday\b|\b24h\b/.test(lower)) {
    timeWindowMs = 24 * 60 * 60 * 1000;
    timeWindowLabel = 'Past 24 hours';
  }

  const inWindow = records.filter((r) =>
    Number.isFinite(timeWindowMs) ? now - r.timestamp <= timeWindowMs : true,
  );

  // 2. Detect subject character
  const villagers = [...sim.configs.values()];
  const subjectVillager = villagers.find((v) =>
    new RegExp(`\\b${v.name.toLowerCase()}\\b`).test(lower),
  );

  // 3. Extract meaningful topic keywords
  const subjectLower = subjectVillager?.name.toLowerCase();
  const tokens = lower
    .replace(/[^a-z0-9_#-]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^#/, ''))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && t !== subjectLower);
  const topicKeywords = [...new Set(tokens)];

  // 4. Identify conversation partners of subjectVillager in time window
  const partnerMap = new Map<string, { id: string; name: string; turnCount: number; lastTimestamp: number }>();
  if (subjectVillager) {
    for (const r of inWindow) {
      if (r.sourceType !== 'conversation') continue;
      const involvesSubject =
        r.actorId === subjectVillager.id || r.partnerIds.includes(subjectVillager.id);
      if (!involvesSubject) continue;
      const otherIds =
        r.actorId === subjectVillager.id
          ? r.partnerIds
          : [r.actorId, ...r.partnerIds.filter((id) => id !== subjectVillager.id)];
      for (const pid of otherIds) {
        if (pid === 'narrator' || pid === subjectVillager.id) continue;
        const pName =
          sim.configs.get(pid)?.name ?? (pid === sim.player.id ? sim.player.name : pid);
        const cur = partnerMap.get(pid) ?? {
          id: pid,
          name: pName,
          turnCount: 0,
          lastTimestamp: 0,
        };
        cur.turnCount += 1;
        cur.lastTimestamp = Math.max(cur.lastTimestamp, r.timestamp);
        partnerMap.set(pid, cur);
      }
    }
  }
  const partners = [...partnerMap.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp);

  // 5. Filter matching records
  const relevantActorIds = new Set<string>();
  if (subjectVillager) {
    relevantActorIds.add(subjectVillager.id);
    for (const p of partners) relevantActorIds.add(p.id);
  }

  const matchingRecords = inWindow.filter((r) => {
    const actorMatch =
      !subjectVillager ||
      relevantActorIds.has(r.actorId) ||
      r.partnerIds.some((id) => relevantActorIds.has(id));
    if (!actorMatch) return false;
    if (topicKeywords.length === 0) return true;
    const hay = `${r.text} ${r.locationLabel} ${r.actorName}`.toLowerCase();
    return topicKeywords.some((kw) => hay.includes(kw));
  });

  // 6. Build concise summary
  const summaryParts: string[] = [];
  if (subjectVillager) {
    if (partners.length > 0) {
      summaryParts.push(
        `In the ${timeWindowLabel.toLowerCase()}, ${subjectVillager.name} spoke with ${partners
          .map((p) => `${p.name} (${p.turnCount} turns)`)
          .join(', ')}.`,
      );
    } else {
      summaryParts.push(
        `In the ${timeWindowLabel.toLowerCase()}, ${subjectVillager.name} has no recorded conversations yet.`,
      );
    }
  }
  if (topicKeywords.length > 0) {
    summaryParts.push(
      `Found ${matchingRecords.length} record${matchingRecords.length === 1 ? '' : 's'} matching [${topicKeywords.join(', ')}] in ${timeWindowLabel.toLowerCase()}.`,
    );
  } else {
    summaryParts.push(
      `Found ${matchingRecords.length} total record${matchingRecords.length === 1 ? '' : 's'} in ${timeWindowLabel.toLowerCase()}.`,
    );
  }

  return {
    query,
    subjectVillager,
    timeWindowLabel,
    topicKeywords,
    partners,
    matchingRecords,
    answerSummary: summaryParts.join(' '),
  };
}
