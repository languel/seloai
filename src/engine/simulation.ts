import type { Rng } from '../core/rng';
import { isTextTooSimilar, parseDialogueAndNarration } from './dialogueText';
import type { SimMind, SimPorts } from './ports';
import { computeSpatialMix, type SpatialMix } from './spatialMix';
import { GENERIC_WORLD_CONTEXT, placeName, type WorldContext } from '../world/worldContext';
import { computeFacing, findNearestWalkableTile, findPath, isTileWalkable } from './pathfinding';
import { ensureVillagerSprite } from './characterGenerator';
import type {
  BubbleEntry,
  ChatMessage,
  Conversation,
  Direction,
  MemoryEntry,
  ModelSettings,
  VillageMap,
  VillagerConfig,
  VillagerRuntime,
} from './types';

interface BubbleKeyframe {
  text: string;
  ageMs: number;
  totalMs: number;
}

interface VillagerKeyframe {
  id: string;
  x: number;
  y: number;
  facing: Direction;
  animFrame: number;
  state: VillagerRuntime['state'];
  currentIntention?: string;
  activeConversationId?: string;
  path: Array<{ x: number; y: number }>;
  currentBubble?: BubbleKeyframe;
  currentThoughtBubble?: BubbleKeyframe;
  memories: MemoryEntry[];
  worldFeed?: string[];
}

interface TimelineKeyframe {
  simTimeMs: number;
  tickCount: number;
  conversations: Conversation[];
  villagers: VillagerKeyframe[];
}

export interface MentionTarget {
  kind: 'narrator' | 'villager';
  id: string;
  name: string;
}

export const CHAR_COLLISION_RADIUS = 0.78;

/** How much world time one line of speech or narration occupies, at a natural speaking pace. */
export function estimateLineDurationMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1400, Math.min(9000, 600 + words * 350));
}

export function computeBubbleDurationMs(
  text: string,
  minMs = 5500,
  maxMs = 16000,
): number {
  return Math.max(minMs, Math.min(maxMs, 3200 + text.length * 70));
}

/**
 * Parses @mentions from user text (case-insensitive) matching villagers by full
 * or first name as well as @Scribe / @Narrator / customized narratorName.
 */
export function parseMentionTargets(
  text: string,
  villagers: VillagerConfig[],
  settings: ModelSettings,
): MentionTarget[] {
  const narratorName = settings.narratorName.trim() || 'Scribe';
  const catalog: Array<{ token: string; targets: MentionTarget[] }> = [];
  const allVillagerTargets: MentionTarget[] = villagers.map((v) => ({
    kind: 'villager',
    id: v.id,
    name: v.name,
  }));

  for (const broadcastAlias of ['world', 'all', 'everyone', 'village']) {
    catalog.push({
      token: broadcastAlias,
      targets: allVillagerTargets,
    });
  }

  for (const alias of [narratorName, 'Scribe', 'Narrator']) {
    if (alias.trim()) {
      catalog.push({
        token: alias.trim().toLowerCase(),
        targets: [{ kind: 'narrator', id: 'narrator', name: narratorName }],
      });
    }
  }
  for (const v of villagers) {
    const target: MentionTarget = { kind: 'villager', id: v.id, name: v.name };
    catalog.push({
      token: v.name.trim().toLowerCase(),
      targets: [target],
    });
    const first = v.name.trim().split(/\s+/)[0];
    if (first && first.toLowerCase() !== v.name.trim().toLowerCase()) {
      catalog.push({
        token: first.toLowerCase(),
        targets: [target],
      });
    }
  }
  // Match longer tokens first so multi-word names win before prefixes
  catalog.sort((a, b) => b.token.length - a.token.length);

  const seen = new Set<string>();
  const ordered: Array<{ index: number; target: MentionTarget }> = [];
  const lower = text.toLowerCase();

  let cursor = 0;
  while (cursor < lower.length) {
    const atPos = lower.indexOf('@', cursor);
    if (atPos === -1) break;
    const prev = atPos > 0 ? lower[atPos - 1] : ' ';
    if (atPos > 0 && /[\p{L}\p{N}_]/u.test(prev)) {
      cursor = atPos + 1;
      continue;
    }
    const rest = lower.slice(atPos + 1);
    const match = catalog.find((entry) => {
      if (!rest.startsWith(entry.token)) return false;
      const afterChar = rest[entry.token.length];
      return !afterChar || !/[\p{L}\p{N}_]/u.test(afterChar);
    });
    if (match) {
      for (const target of match.targets) {
        if (!seen.has(target.id)) {
          seen.add(target.id);
          ordered.push({ index: atPos, target });
        }
      }
      cursor = atPos + 1 + match.token.length;
    } else {
      cursor = atPos + 1;
    }
  }

  ordered.sort((a, b) => a.index - b.index);
  return ordered.map((o) => o.target);
}

export interface PlayerAvatar {
  id: string;
  name: string;
  x: number;
  y: number;
  facing: Direction;
  path: Array<{ x: number; y: number }>;
  animFrame: number;
  speed: number;
  isMoving: boolean;
  lastNudgeAt: number;
}

export interface SimulationSnapshot {
  tickCount: number;
  fps: number;
  paused: boolean;
  speedMultiplier: number;
  runtimes: VillagerRuntime[];
  conversations: Conversation[];
  player: PlayerAvatar;
}

const MAX_VILLAGER_MEMORIES = 64;
const MAX_MESSAGES_PER_CONV = 160;
const MAX_CONVERSATIONS = 40;
const DEFAULT_MAX_TIMELINE_FRAMES = 450;

/**
 * Whether a line of the story plainly says the well's water came back or ran dry. Only
 * clear statements count ("the water flows again", "she releases the water", "the well
 * brims"), never a hint (a drop seeping, a sound of water), and a negated sentence ("the
 * well does not flow") says nothing. Returns the change, or null.
 */
export function wellWaterIn(text: string): 'dry' | 'flowing' | null {
  let found: 'dry' | 'flowing' | null = null;
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    const s = sentence.toLowerCase();
    if (!/\b(well|water|spring|springs)\b/.test(s)) continue;
    if (/\b(not|never|no longer|won't|will not|cannot|can't|unless|until|if|refuses?)\b/.test(s)) continue;
    if (
      /\b(runs?|ran|gone|goes|went) dry\b|\bdr(y|ies|ied) up\b|\bwell (is|lies|stands) dry\b/.test(s)
    ) {
      found = 'dry';
    } else if (
      /\b(water|well|spring)s?\b[^.]{0,40}\b(flows?|flowing|flowed|gush(es|ed|ing)?|surges?|brims?|brimming|overflows?|spills? over|wells up|springs? (forth|up|back))\b/.test(s) ||
      /\bwater\b[^.]{0,12}\b(returns?|returned|comes? back|came back)\b/.test(s) ||
      /\breleas(es|ed|ing)\b[^.]{0,30}\b(the )?(water|spring|springs|well)\b/.test(s) ||
      /\b(fills|filled|refills|refilled)\b[^.]{0,20}\b(the )?well\b|\bwell (fills|filled|refills)\b/.test(s)
    ) {
      found = 'flowing';
    }
  }
  return found;
}

export class VillageSimulation {
  public map: VillageMap;
  public configs: Map<string, VillagerConfig> = new Map();
  public runtimes: Map<string, VillagerRuntime> = new Map();
  public conversations: Conversation[] = [];
  public player: PlayerAvatar;
  private pausedFlag = false;
  private resumeWaiters: Array<() => void> = [];
  public speedMultiplier = 1;
  public tickCount = 0;
  public simTimeMs = 0;
  public fps = 60;
  public modelSettings: ModelSettings;
  public focalWorldlineId: string | 'traveler' = 'traveler';
  /**
   * The well's water as the story has made it: flowing, dry, or (null) as the world was
   * drawn. The story sets it when a line says so plainly; a reset story clears it.
   */
  public wellWater: 'dry' | 'flowing' | null = null;
  /**
   * While true, no conversation or scene starts on its own (people still move about): the
   * app holds the story until a voice is ready, so it does not begin in the browser's voice.
   */
  public holdStory = false;
  /** Setting-specific knowledge supplied by the active world pack. */
  public world: WorldContext;

  private listeners = new Set<() => void>();
  private aiAccumulator = 0;
  private planningVillagers = new Set<string>();
  private lastNotifyAt = 0;
  private lastMoveSimMs = new Map<string, number>();
  private lastThinkSimMs = new Map<string, number>();
  private timeline: TimelineKeyframe[] = [];
  private maxTimelineFrames = DEFAULT_MAX_TIMELINE_FRAMES;
  private lastDiscreteConvSig = '';
  private lastConvItemCache = new Map<string, { sig: string; snap: Conversation }>();
  private lastConvSignature = '';
  private lastCachedConvSnapshot: Conversation[] = [];
  private lastMemCache = new Map<string, { sig: string; list: MemoryEntry[] }>();
  private lastFeedCache = new Map<string, { sig: string; list: string[] }>();
  private lastAppliedConvRef: Conversation[] | null = null;
  private wasRewinding = false;

  private readonly mind: SimMind;
  private readonly rng: Rng;
  private readonly timestamp: (simTimeMs: number) => number;
  private readonly timerMode: 'wall' | 'sim';
  private simTimers: Array<{ dueSimMs: number; resolve: () => void }> = [];

  constructor(
    map: VillageMap,
    villagers: VillagerConfig[],
    conversations: Conversation[],
    settings: ModelSettings,
    ports: SimPorts,
  ) {
    this.mind = ports.mind;
    this.rng = ports.rng ?? Math.random;
    this.timestamp = ports.timestamp ?? (() => Date.now());
    this.timerMode = ports.timers ?? 'wall';
    this.world = ports.world ?? GENERIC_WORLD_CONTEXT;
    this.map = map;
    this.modelSettings = settings;
    this.conversations = conversations;
    const spawn = map.spawnPoints[0] ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
    const safeSpawn = findNearestWalkableTile(map, spawn.x, spawn.y);
    this.player = {
      id: 'human-visitor',
      name: settings.playerName?.trim() || this.world.playerName,
      x: safeSpawn.x,
      y: safeSpawn.y,
      facing: 'down',
      path: [],
      animFrame: 0,
      speed: 2.8,
      isMoving: false,
      lastNudgeAt: 0,
    };
    this.syncVillagers(villagers);
  }

  /** While paused the world holds still: no movement, no new turns, and speech is suspended. */
  get paused(): boolean {
    return this.pausedFlag;
  }

  set paused(value: boolean) {
    if (value === this.pausedFlag) return;
    this.pausedFlag = value;
    this.mind.setSpeechPaused(value);
    if (!value) {
      const waiters = this.resumeWaiters.splice(0);
      for (const resume of waiters) resume();
    }
    this.notify(true);
  }

  /**
   * Gives a line its share of world time, so the pace of events follows the world clock
   * (and therefore the time slider) rather than how fast text can be produced. Time already
   * spent since `startedSimMs`, for example on speech playback, counts toward it.
   */
  private async paceLine(text: string, startedSimMs: number): Promise<void> {
    if (this.timerMode !== 'sim') return;
    const remaining = estimateLineDurationMs(text) - (this.simTimeMs - startedSimMs);
    if (remaining > 0) await this.waitSimTime(remaining);
  }

  /** Resolves at once when running, or when the world is next resumed. */
  private whenRunning(): Promise<void> {
    if (!this.pausedFlag) return Promise.resolve();
    return new Promise((resolve) => this.resumeWaiters.push(resolve));
  }

  /** Timestamp for records created now (wall clock by default, sim-derived in reproducible runs). */
  private now(): number {
    return this.timestamp(this.simTimeMs);
  }

  /** Resolves once the simulation clock has advanced by `ms` (only moves while it is stepped). */
  public waitSimTime(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.simTimers.push({ dueSimMs: this.simTimeMs + ms, resolve });
    });
  }

  /** Waits in wall time or, in reproducible runs, in simulation time. */
  private sleep(ms: number): Promise<void> {
    if (this.timerMode === 'wall') return new Promise((resolve) => setTimeout(resolve, ms));
    return this.waitSimTime(ms);
  }

  private resolveDueSimTimers() {
    if (this.simTimers.length === 0) return;
    const due = this.simTimers.filter((t) => t.dueSimMs <= this.simTimeMs);
    if (due.length === 0) return;
    this.simTimers = this.simTimers.filter((t) => t.dueSimMs > this.simTimeMs);
    for (const timer of due) timer.resolve();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public notify(force = false) {
    const now = performance.now();
    if (!force && now - this.lastNotifyAt < 120) return;
    this.lastNotifyAt = now;
    for (const fn of this.listeners) fn();
  }

  /** Switches the setting-specific knowledge, e.g. when a different world pack is loaded. */
  setWorld(world: WorldContext) {
    this.world = world;
    this.player.name = this.modelSettings.playerName?.trim() || world.playerName;
    this.notify(true);
  }

  /** Everyone's pronouns from the character sheets (the voice's gender), for the story prompts. */
  private castPronouns(): { name: string; gender?: string }[] {
    return [
      ...Array.from(this.configs.values()).map((c) => ({ name: c.name, gender: c.voice?.gender })),
      { name: this.player.name, gender: this.modelSettings.playerVoice?.gender },
    ];
  }

  updateSettings(settings: ModelSettings) {
    this.modelSettings = settings;
    this.player.name = settings.playerName?.trim() || this.world.playerName;
    this.notify(true);
  }

  updateMap(newMap: VillageMap) {
    this.map = newMap;
    // Re-anchor any villager or player stranded on newly blocked tiles
    for (const rt of this.runtimes.values()) {
      if (!isTileWalkable(newMap, Math.round(rt.x), Math.round(rt.y))) {
        const safe = findNearestWalkableTile(newMap, rt.x, rt.y);
        rt.x = safe.x;
        rt.y = safe.y;
        rt.path = [];
      }
    }
    if (!isTileWalkable(newMap, Math.round(this.player.x), Math.round(this.player.y))) {
      const safe = findNearestWalkableTile(newMap, this.player.x, this.player.y);
      this.player.x = safe.x;
      this.player.y = safe.y;
      this.player.path = [];
    }
    this.notify(true);
  }

  public getMemoryStats(): {
    conversationCount: number;
    activeConversationCount: number;
    totalMessages: number;
    villagerCount: number;
    totalMemories: number;
    totalWorldFeedItems: number;
    timelineFrames: number;
    cachedConvSnapshots: number;
  } {
    let totalMessages = 0;
    let activeConversationCount = 0;
    for (const c of this.conversations) {
      totalMessages += c.messages.length;
      if (c.active) activeConversationCount += 1;
    }
    let totalMemories = 0;
    let totalWorldFeedItems = 0;
    for (const rt of this.runtimes.values()) {
      totalMemories += rt.memories.length;
      totalWorldFeedItems += rt.worldFeed?.length ?? 0;
    }
    return {
      conversationCount: this.conversations.length,
      activeConversationCount,
      totalMessages,
      villagerCount: this.runtimes.size,
      totalMemories,
      totalWorldFeedItems,
      timelineFrames: this.timeline.length,
      cachedConvSnapshots: this.lastConvItemCache.size,
    };
  }

  public trimMemoryUsage(opts?: {
    maxTimelineFrames?: number;
    maxMessagesPerConv?: number;
    maxMemoriesPerVillager?: number;
  }) {
    const keepFrames = Math.max(30, opts?.maxTimelineFrames ?? 180);
    const keepMsgs = Math.max(20, opts?.maxMessagesPerConv ?? MAX_MESSAGES_PER_CONV);
    const keepMems = Math.max(12, opts?.maxMemoriesPerVillager ?? MAX_VILLAGER_MEMORIES);

    if (this.timeline.length > keepFrames) {
      this.timeline.splice(0, this.timeline.length - keepFrames);
    }
    if (this.conversations.length > MAX_CONVERSATIONS) {
      this.conversations = this.conversations.slice(0, MAX_CONVERSATIONS);
    }
    for (const conv of this.conversations) {
      this.trimConversationMessages(conv, keepMsgs);
    }
    for (const rt of this.runtimes.values()) {
      this.trimVillagerMemories(rt, keepMems);
      if (rt.worldFeed && rt.worldFeed.length > 12) {
        rt.worldFeed = rt.worldFeed.slice(-12);
      }
      if (rt.recentUtterances && rt.recentUtterances.length > 6) {
        rt.recentUtterances = rt.recentUtterances.slice(-6);
      }
    }
    this.pruneConvItemCache();
    this.notify(true);
  }

  private trimConversationMessages(conv: Conversation, maxMessages = MAX_MESSAGES_PER_CONV) {
    if (conv.messages.length <= maxMessages) return;
    // Keep opening 2 framing messages + newest tail so context stays coherent without unbounded growth
    const head = conv.messages.slice(0, 2);
    const tail = conv.messages.slice(-(maxMessages - 2));
    conv.messages = [...head, ...tail];
  }

  private pushConversationMessage(conv: Conversation, ...msgs: ChatMessage[]) {
    conv.messages.push(...msgs);
    this.trimConversationMessages(conv, MAX_MESSAGES_PER_CONV);
  }

  private trimVillagerMemories(rt: VillagerRuntime, maxMemories = MAX_VILLAGER_MEMORIES) {
    if (rt.memories.length <= maxMemories) return;
    // Preserve high-importance anchor memories + most recent memories
    const recentSlice = rt.memories.slice(-(maxMemories - 12));
    const recentIds = new Set(recentSlice.map((m) => m.id));
    const olderImportant = rt.memories
      .slice(0, rt.memories.length - (maxMemories - 12))
      .filter((m) => !recentIds.has(m.id))
      .sort((a, b) => b.importance - a.importance || b.timestamp - a.timestamp)
      .slice(0, 12);
    rt.memories = [...olderImportant, ...recentSlice].sort((a, b) => a.timestamp - b.timestamp);
  }

  private pushVillagerMemory(rt: VillagerRuntime, entry: MemoryEntry) {
    rt.memories.push(entry);
    this.trimVillagerMemories(rt, MAX_VILLAGER_MEMORIES);
  }

  private pruneConvItemCache() {
    if (this.lastConvItemCache.size <= MAX_CONVERSATIONS * 2) return;
    const activeIds = new Set(this.conversations.map((c) => c.id));
    for (const key of this.lastConvItemCache.keys()) {
      if (!activeIds.has(key)) {
        this.lastConvItemCache.delete(key);
      }
    }
  }

  syncVillagers(villagers: VillagerConfig[]) {
    const nextIds = new Set(villagers.map((v) => v.id));
    for (const oldId of this.runtimes.keys()) {
      if (!nextIds.has(oldId)) {
        this.runtimes.delete(oldId);
        this.lastMemCache.delete(oldId);
        this.lastFeedCache.delete(oldId);
        this.lastMoveSimMs.delete(oldId);
        this.lastThinkSimMs.delete(oldId);
      }
    }
    this.configs.clear();

    for (const rawVillager of villagers) {
      const v = ensureVillagerSprite(rawVillager);
      this.configs.set(v.id, v);
      const existing = this.runtimes.get(v.id);
      if (!existing) {
        const start = this.startingSpotFor(v);
        const safe = findNearestWalkableTile(this.map, start.x, start.y);
        this.runtimes.set(v.id, {
          id: v.id,
          x: safe.x,
          y: safe.y,
          facing: 'down',
          path: [],
          state: 'idle',
          activityLabel: v.plan,
          currentIntention: v.plan,
          worldFeed: [`Entered ${placeName(this.world)} with purpose: ${v.plan}`],
          blockedTicks: 0,
          memories: [
            {
              id: `mem-init-${v.id}`,
              timestamp: this.now(),
              importance: 5,
              kind: 'observation',
              summary: v.plan,
            },
          ],
          lastThinkAt: this.now() - 4500 - this.rng() * 2500,
          lastMoveAt: this.now() - 2000 - this.rng() * 2000,
          animFrame: 0,
        });
        this.lastMoveSimMs.set(v.id, this.simTimeMs - 2200 - this.rng() * 2000);
        this.lastThinkSimMs.set(v.id, this.simTimeMs - 5500 - this.rng() * 2500);
      }
    }
    if (this.timeline.length === 0) {
      this.recordTimelineKeyframe();
    }
    this.notify(true);
  }

  exportCharacterHistories(): Record<
    string,
    { memories: MemoryEntry[]; currentIntention?: string; worldFeed?: string[] }
  > {
    const out: Record<
      string,
      { memories: MemoryEntry[]; currentIntention?: string; worldFeed?: string[] }
    > = {};
    for (const [id, rt] of this.runtimes.entries()) {
      out[id] = {
        memories: structuredClone(rt.memories),
        currentIntention: rt.currentIntention,
        worldFeed: [...(rt.worldFeed ?? [])],
      };
    }
    return out;
  }

  applyCharacterHistories(
    histories: Record<
      string,
      { memories: MemoryEntry[]; currentIntention?: string; worldFeed?: string[] }
    >,
  ) {
    for (const [id, hist] of Object.entries(histories)) {
      const rt = this.runtimes.get(id);
      if (!rt) continue;
      if (Array.isArray(hist.memories)) {
        rt.memories = structuredClone(hist.memories);
      }
      if (typeof hist.currentIntention === 'string' && hist.currentIntention.trim()) {
        rt.currentIntention = hist.currentIntention;
      }
      if (Array.isArray(hist.worldFeed)) {
        rt.worldFeed = [...hist.worldFeed];
      }
    }
    this.resetTimelineHistory();
    this.notify(true);
  }

  replaceConversations(conversations: Conversation[]) {
    this.conversations = structuredClone(conversations);
    this.resetTimelineHistory();
    this.notify(true);
  }

  clearDatabase() {
    this.conversations = [];
    this.focalWorldlineId = 'scribe';
    this.wellWater = null;
    for (const [id, rt] of this.runtimes.entries()) {
      const cfg = this.configs.get(id);
      rt.activeConversationId = undefined;
      rt.state = 'idle';
      rt.worldFeed = cfg ? [`Fresh story started: ${cfg.plan}`] : [];
      rt.memories = cfg
        ? [
            {
              id: `mem-init-${id}-${this.now()}`,
              timestamp: this.now(),
              importance: 5,
              kind: 'observation',
              summary: cfg.plan,
            },
          ]
        : [];
    }
    this.resetTimelineHistory();
    this.notify(true);
  }

  /**
   * Starts the story again in the world as it is now: everything `clearDatabase` clears,
   * and every character back at their starting spot (worked out from today's places, so a
   * well added since counts) with their opening intention. The world and cast are kept.
   */
  resetStory() {
    this.mind.flushAudioQueue();
    this.mind.resetStoryMemory?.();
    this.clearDatabase();
    for (const [id, rt] of this.runtimes.entries()) {
      const cfg = this.configs.get(id);
      if (!cfg) continue;
      const start = this.startingSpotFor(cfg);
      const safe = findNearestWalkableTile(this.map, start.x, start.y);
      rt.x = safe.x;
      rt.y = safe.y;
      rt.path = [];
      rt.facing = 'down';
      rt.currentIntention = cfg.plan;
      rt.activityLabel = cfg.plan;
      rt.recentUtterances = [];
      rt.currentBubble = undefined;
      rt.blockedTicks = 0;
    }
    const spawn = this.map.spawnPoints[0] ?? { x: Math.floor(this.map.width / 2), y: Math.floor(this.map.height / 2) };
    const safe = findNearestWalkableTile(this.map, spawn.x, spawn.y);
    this.player.x = safe.x;
    this.player.y = safe.y;
    this.player.path = [];
    this.notify(true);
  }

  /** Sets the well's water and tells everyone in the village. */
  setWellWater(state: 'dry' | 'flowing' | null) {
    if (state === this.wellWater) return;
    this.wellWater = state;
    if (state) {
      const news = state === 'flowing' ? 'The well flows again: the water has come back.' : 'The well has run dry.';
      for (const rt of this.runtimes.values()) this.appendWorldEvent(rt, news);
    }
    this.notify(true);
  }

  /** Reads a finished line of the story for the well's water coming back or running dry. */
  private noticeWellWater(text: string) {
    const change = wellWaterIn(text);
    if (change) this.setWellWater(change);
  }

  private getOccupiedTileSet(excludeId?: string): Set<string> {
    const blocked = new Set<string>();
    if (excludeId !== this.player.id) {
      blocked.add(`${Math.round(this.player.x)},${Math.round(this.player.y)}`);
    }
    for (const rt of this.runtimes.values()) {
      if (rt.id !== excludeId) {
        blocked.add(`${Math.round(rt.x)},${Math.round(rt.y)}`);
      }
    }
    return blocked;
  }

  private findCharacterCollision(
    nx: number,
    ny: number,
    curX: number,
    curY: number,
    selfId: string,
  ): string | null {
    const check = (ox: number, oy: number, otherId: string) => {
      if (otherId === selfId) return false;
      const curDist = Math.hypot(curX - ox, curY - oy);
      const nextDist = Math.hypot(nx - ox, ny - oy);
      return nextDist < CHAR_COLLISION_RADIUS && nextDist < curDist;
    };

    if (check(this.player.x, this.player.y, this.player.id)) {
      return this.player.id;
    }
    for (const rt of this.runtimes.values()) {
      if (check(rt.x, rt.y, rt.id)) return rt.id;
    }
    return null;
  }

  private isStepWalkableAndUnblocked(
    nx: number,
    ny: number,
    curX: number,
    curY: number,
    selfId: string,
  ): { ok: boolean; blockerId: string | null } {
    if (!isTileWalkable(this.map, Math.round(nx), Math.round(ny))) {
      return { ok: false, blockerId: null };
    }
    const blockerId = this.findCharacterCollision(nx, ny, curX, curY, selfId);
    return { ok: blockerId === null, blockerId };
  }

  private appendWorldEvent(rt: VillagerRuntime, event: string) {
    const feed = rt.worldFeed ?? [];
    rt.worldFeed = [...feed, event].slice(-12);
  }

  private findAdjacentStandTile(targetX: number, targetY: number, selfId: string): { x: number; y: number } {
    const offsets = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
      { dx: 2, dy: 0 },
      { dx: -2, dy: 0 },
      { dx: 0, dy: 2 },
      { dx: 0, dy: -2 },
    ];
    const occupied = this.getOccupiedTileSet(selfId);
    const tx = Math.round(targetX);
    const ty = Math.round(targetY);
    for (const off of offsets) {
      const cx = tx + off.dx;
      const cy = ty + off.dy;
      if (isTileWalkable(this.map, cx, cy) && !occupied.has(`${cx},${cy}`)) {
        return { x: cx, y: cy };
      }
    }
    return findNearestWalkableTile(this.map, tx + 1, ty);
  }

  movePlayerTo(tileX: number, tileY: number) {
    const occupied = this.getOccupiedTileSet(this.player.id);
    const target = findNearestWalkableTile(this.map, tileX, tileY);
    const path = findPath(this.map, { x: this.player.x, y: this.player.y }, target, occupied);
    this.player.path = path;
  }

  nudgePlayer(dx: number, dy: number, dt: number) {
    if (dx === 0 && dy === 0) return;
    this.player.path = [];
    this.player.isMoving = true;
    this.player.lastNudgeAt = performance.now();
    const nx = this.player.x + dx * this.player.speed * dt;
    const ny = this.player.y + dy * this.player.speed * dt;
    if (
      this.isStepWalkableAndUnblocked(nx, this.player.y, this.player.x, this.player.y, this.player.id).ok
    ) {
      this.player.x = nx;
    }
    if (
      this.isStepWalkableAndUnblocked(this.player.x, ny, this.player.x, this.player.y, this.player.id).ok
    ) {
      this.player.y = ny;
    }
    this.player.facing = computeFacing({ x: 0, y: 0 }, { x: dx, y: dy }, this.player.facing);
    this.player.animFrame += dt * 7;
  }

  stepFrame(rawDt: number) {
    if (rawDt > 0) {
      this.fps = Math.round(this.fps * 0.9 + (1 / Math.max(0.004, rawDt)) * 0.1);
    }

    // Player moves even if simulation is paused so inspection feels responsive
    this.advanceEntityPath(this.player, rawDt);
    this.player.isMoving =
      this.player.path.length > 0 || performance.now() - this.player.lastNudgeAt < 120;
    this.mind.refreshActiveSpatialMix();

    if (this.paused || Math.abs(this.speedMultiplier) < 0.001) {
      this.shiftAllBubbleClocks(Math.min(0.1, Math.max(0, rawDt)) * 1000);
      return;
    }

    const clampedRaw = Math.min(0.1, Math.max(0, rawDt));

    if (this.speedMultiplier < 0) {
      if (!this.wasRewinding) {
        this.mind.flushAudioQueue();
        this.wasRewinding = true;
      }
      this.stepRewind(clampedRaw);
      return;
    }

    if (this.wasRewinding) {
      this.wasRewinding = false;
      // Branch forward cleanly from the rewound point by dropping superseded future keyframes
      while (this.timeline.length > 1 && this.timeline[this.timeline.length - 1].simTimeMs > this.simTimeMs) {
        this.timeline.pop();
      }
      for (const vId of this.runtimes.keys()) {
        if ((this.lastMoveSimMs.get(vId) ?? -Infinity) > this.simTimeMs) {
          this.lastMoveSimMs.set(vId, this.simTimeMs);
        }
        if ((this.lastThinkSimMs.get(vId) ?? -Infinity) > this.simTimeMs) {
          this.lastThinkSimMs.set(vId, this.simTimeMs);
        }
      }
    }

    const dt = clampedRaw * this.speedMultiplier;
    this.simTimeMs += dt * 1000;
    this.tickCount++;
    this.resolveDueSimTimers();

    if (this.speedMultiplier !== 1) {
      this.shiftAllBubbleClocks((1 - this.speedMultiplier) * clampedRaw * 1000);
    }

    const now = this.now();
    for (const rt of this.runtimes.values()) {
      const cfg = this.configs.get(rt.id);
      if (!cfg) continue;

      if (rt.currentBubble && rt.currentBubble.expiresAt <= now) {
        rt.currentBubble = undefined;
      }
      if (rt.currentThoughtBubble && rt.currentThoughtBubble.expiresAt <= now) {
        rt.currentThoughtBubble = undefined;
      }

      if (rt.path.length > 0 && rt.state !== 'conversing' && rt.state !== 'thinking' && rt.state !== 'speaking') {
        rt.state = 'walking';
        const hasMore = this.advanceVillagerPath(rt, cfg.speed, dt);
        if (!hasMore && rt.path.length === 0) {
          rt.state = 'idle';
          rt.lastMoveAt = now;
          this.lastMoveSimMs.set(rt.id, this.simTimeMs);
        }
      } else if (rt.state === 'walking') {
        rt.state = 'idle';
      }
    }

    this.aiAccumulator += dt;
    if (this.aiAccumulator >= 1.65) {
      this.aiAccumulator = 0;
      this.runAutonomousDecisions();
      this.notify();
    }

    const lastKf = this.timeline[this.timeline.length - 1];
    const discreteSig = this.computeDiscreteConversationSignature();
    if (
      !lastKf ||
      discreteSig !== this.lastDiscreteConvSig ||
      this.simTimeMs - lastKf.simTimeMs >= 200
    ) {
      this.lastDiscreteConvSig = discreteSig;
      this.recordTimelineKeyframe();
    }
  }

  getRewindInfo(): { oldestSimMs: number; newestSimMs: number; behindPresentSec: number; canRewind: boolean } {
    const oldest = this.timeline[0]?.simTimeMs ?? this.simTimeMs;
    const newest = this.timeline[this.timeline.length - 1]?.simTimeMs ?? this.simTimeMs;
    return {
      oldestSimMs: oldest,
      newestSimMs: newest,
      behindPresentSec: Math.max(0, (newest - this.simTimeMs) / 1000),
      canRewind: this.timeline.length > 1 && this.simTimeMs > oldest + 20,
    };
  }

  private resetTimelineHistory() {
    this.timeline = [];
    this.simTimeMs = 0;
    this.lastConvSignature = '';
    this.lastDiscreteConvSig = '';
    this.lastCachedConvSnapshot = [];
    this.lastConvItemCache.clear();
    this.lastMemCache.clear();
    this.lastFeedCache.clear();
    this.lastAppliedConvRef = null;
    this.wasRewinding = false;
    this.recordTimelineKeyframe();
  }

  private computeDiscreteConversationSignature(): string {
    if (this.conversations.length === 0) return '0';
    return this.conversations
      .map((c) => `${c.id}:${c.active ? 1 : 0}:${c.messages.length}`)
      .join('|');
  }

  private computeConversationSignature(): string {
    if (this.conversations.length === 0) return '0';
    return this.conversations
      .map(
        (c) =>
          `${c.id}:${c.messages.length}:${c.updatedAt}:${c.messages[c.messages.length - 1]?.text.length ?? 0}`,
      )
      .join('|');
  }

  private shiftBubbleEntry(entry: BubbleEntry | undefined, deltaMs: number) {
    if (!entry || deltaMs === 0) return;
    entry.expiresAt += deltaMs;
    if (entry.startedAt !== undefined) {
      entry.startedAt += deltaMs;
    }
  }

  private shiftAllBubbleClocks(deltaMs: number) {
    if (deltaMs === 0) return;
    for (const rt of this.runtimes.values()) {
      this.shiftBubbleEntry(rt.currentBubble, deltaMs);
      this.shiftBubbleEntry(rt.currentThoughtBubble, deltaMs);
    }
  }

  private snapshotBubbleEntry(entry: BubbleEntry | undefined, now: number): BubbleKeyframe | undefined {
    if (!entry?.text) return undefined;
    const start = entry.startedAt ?? now;
    const totalMs = Math.max(500, entry.expiresAt - start);
    const ageMs = Math.max(0, Math.min(totalMs, now - start));
    return { text: entry.text, ageMs, totalMs };
  }

  private restoreBubbleEntry(snap: BubbleKeyframe | undefined, now: number): BubbleEntry | undefined {
    if (!snap) return undefined;
    const startedAt = now - snap.ageMs;
    const expiresAt = startedAt + snap.totalMs;
    if (expiresAt <= now) return undefined;
    return { text: snap.text, startedAt, expiresAt };
  }

  private recordTimelineKeyframe() {
    const now = this.now();
    const convSig = this.computeConversationSignature();
    if (convSig !== this.lastConvSignature || this.timeline.length === 0) {
      this.lastConvSignature = convSig;
      // Only structuredClone individual conversations that actually mutated since the last keyframe;
      // unchanged older conversations share immutable references across keyframes.
      const nextSnap: Conversation[] = [];
      for (const c of this.conversations) {
        const lastMsg = c.messages[c.messages.length - 1];
        const cSig = `${c.active ? 1 : 0}:${c.messages.length}:${c.updatedAt}:${lastMsg?.text.length ?? 0}`;
        let cached = this.lastConvItemCache.get(c.id);
        if (!cached || cached.sig !== cSig) {
          cached = { sig: cSig, snap: structuredClone(c) };
          this.lastConvItemCache.set(c.id, cached);
        }
        nextSnap.push(cached.snap);
      }
      this.lastCachedConvSnapshot = nextSnap;
      this.pruneConvItemCache();
    }
    const villagers: VillagerKeyframe[] = [];
    for (const rt of this.runtimes.values()) {
      const memSig = `${rt.memories.length}:${rt.memories[rt.memories.length - 1]?.id ?? ''}`;
      let memSnap = this.lastMemCache.get(rt.id);
      if (!memSnap || memSnap.sig !== memSig) {
        memSnap = { sig: memSig, list: structuredClone(rt.memories) };
        this.lastMemCache.set(rt.id, memSnap);
      }
      const feedArr = rt.worldFeed ?? [];
      const feedSig = `${feedArr.length}:${feedArr[feedArr.length - 1] ?? ''}`;
      let feedSnap = this.lastFeedCache.get(rt.id);
      if (!feedSnap || feedSnap.sig !== feedSig) {
        feedSnap = { sig: feedSig, list: [...feedArr] };
        this.lastFeedCache.set(rt.id, feedSnap);
      }
      villagers.push({
        id: rt.id,
        x: rt.x,
        y: rt.y,
        facing: rt.facing,
        animFrame: rt.animFrame,
        state: rt.state,
        currentIntention: rt.currentIntention,
        activeConversationId: rt.activeConversationId,
        path: rt.path.map((p) => ({ ...p })),
        currentBubble: this.snapshotBubbleEntry(rt.currentBubble, now),
        currentThoughtBubble: this.snapshotBubbleEntry(rt.currentThoughtBubble, now),
        memories: memSnap.list,
        worldFeed: feedSnap.list,
      });
    }

    this.timeline.push({
      simTimeMs: this.simTimeMs,
      tickCount: this.tickCount,
      conversations: this.lastCachedConvSnapshot,
      villagers,
    });
    if (this.timeline.length > this.maxTimelineFrames) {
      this.timeline.shift();
    }
  }

  private stepRewind(clampedRaw: number) {
    if (this.timeline.length === 0) {
      this.shiftAllBubbleClocks(clampedRaw * 1000);
      return;
    }
    const oldest = this.timeline[0];
    const newest = this.timeline[this.timeline.length - 1];
    const targetMs = Math.max(
      oldest.simTimeMs,
      this.simTimeMs + clampedRaw * this.speedMultiplier * 1000,
    );

    let lo = 0;
    let hi = this.timeline.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.timeline[mid].simTimeMs <= targetMs) lo = mid;
      else hi = mid;
    }
    const frameA = this.timeline[lo] ?? oldest;
    const frameB = this.timeline[Math.min(this.timeline.length - 1, lo + 1)] ?? newest;
    const span = frameB.simTimeMs - frameA.simTimeMs;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (targetMs - frameA.simTimeMs) / span)) : 0;
    const discrete = alpha >= 0.5 ? frameB : frameA;
    const now = this.now();

    const aById = new Map(frameA.villagers.map((v) => [v.id, v]));
    const bById = new Map(frameB.villagers.map((v) => [v.id, v]));

    let discreteChanged = false;
    for (const rt of this.runtimes.values()) {
      const a = aById.get(rt.id);
      const b = bById.get(rt.id) ?? a;
      if (!a || !b) continue;

      rt.x = a.x + (b.x - a.x) * alpha;
      rt.y = a.y + (b.y - a.y) * alpha;
      rt.animFrame = a.animFrame + (b.animFrame - a.animFrame) * alpha;

      const d = alpha >= 0.5 ? b : a;
      rt.facing = d.facing;
      rt.state = d.state;
      rt.currentIntention = d.currentIntention;
      rt.activeConversationId = d.activeConversationId;
      rt.path = d.path.map((p) => ({ ...p }));
      rt.currentBubble = this.restoreBubbleEntry(d.currentBubble, now);
      rt.currentThoughtBubble = this.restoreBubbleEntry(d.currentThoughtBubble, now);
      if (
        rt.memories.length !== d.memories.length ||
        rt.memories[rt.memories.length - 1]?.id !== d.memories[d.memories.length - 1]?.id
      ) {
        rt.memories = structuredClone(d.memories);
        discreteChanged = true;
      }
      if (d.worldFeed && rt.worldFeed?.length !== d.worldFeed.length) {
        rt.worldFeed = [...d.worldFeed];
      }
    }

    if (discrete.conversations !== this.lastAppliedConvRef) {
      this.lastAppliedConvRef = discrete.conversations;
      this.conversations = structuredClone(discrete.conversations);
      this.lastConvSignature = this.computeConversationSignature();
      this.lastCachedConvSnapshot = discrete.conversations;
      discreteChanged = true;
    }

    this.simTimeMs = targetMs;
    this.tickCount = discrete.tickCount;
    this.notify(discreteChanged);
  }

  private stepAlongPathWithCollision(
    entity: {
      x: number;
      y: number;
      path: Array<{ x: number; y: number }>;
      facing: Direction;
      animFrame: number;
      avoidSign?: 1 | -1;
      avoidTargetId?: string;
    },
    stepSize: number,
    animDelta: number,
    selfId: string,
  ): { progressed: boolean; sidestepped: boolean; reachedEnd: boolean; blockerId: string | null } {
    if (entity.path.length === 0) {
      return { progressed: false, sidestepped: false, reachedEnd: true, blockerId: null };
    }
    const next = entity.path[0];
    const dx = next.x - entity.x;
    const dy = next.y - entity.y;
    const dist = Math.hypot(dx, dy);

    const targetX = dist <= stepSize ? next.x : entity.x + (dx / dist) * stepSize;
    const targetY = dist <= stepSize ? next.y : entity.y + (dy / dist) * stepSize;

    const direct = this.isStepWalkableAndUnblocked(targetX, targetY, entity.x, entity.y, selfId);
    if (direct.ok) {
      if (dist > 0.015) {
        entity.facing = computeFacing(entity, next, entity.facing);
      }
      entity.animFrame += animDelta;
      entity.x = targetX;
      entity.y = targetY;
      entity.avoidSign = undefined;
      entity.avoidTargetId = undefined;
      if (dist <= stepSize) {
        entity.path.shift();
      }
      return {
        progressed: true,
        sidestepped: false,
        reachedEnd: entity.path.length === 0,
        blockerId: null,
      };
    }

    // Try sliding along forward axes for wall corners (only when not colliding with a character,
    // otherwise axis slide can pull back toward a character we just sidestepped around)
    if (!direct.blockerId) {
      if (Math.abs(dx) > 0.05) {
        const slideX = entity.x + Math.sign(dx) * Math.min(stepSize, Math.abs(dx));
        if (this.isStepWalkableAndUnblocked(slideX, entity.y, entity.x, entity.y, selfId).ok) {
          entity.facing = dx >= 0 ? 'right' : 'left';
          entity.animFrame += animDelta * 0.7;
          entity.x = slideX;
          return { progressed: true, sidestepped: false, reachedEnd: false, blockerId: null };
        }
      }
      if (Math.abs(dy) > 0.05) {
        const slideY = entity.y + Math.sign(dy) * Math.min(stepSize, Math.abs(dy));
        if (this.isStepWalkableAndUnblocked(entity.x, slideY, entity.x, entity.y, selfId).ok) {
          entity.facing = dy >= 0 ? 'down' : 'up';
          entity.animFrame += animDelta * 0.7;
          entity.y = slideY;
          return { progressed: true, sidestepped: false, reachedEnd: false, blockerId: null };
        }
      }
    }

    // Perpendicular sidestep with locked avoidance side per blocker so characters never oscillate left-right
    const pickSideOrder = (axis: 'x' | 'y'): [1 | -1, 1 | -1] => {
      if (direct.blockerId && entity.avoidTargetId === direct.blockerId && entity.avoidSign) {
        return [entity.avoidSign, (entity.avoidSign === 1 ? -1 : 1) as 1 | -1];
      }
      if (direct.blockerId) {
        const blocker =
          direct.blockerId === this.player.id ? this.player : this.runtimes.get(direct.blockerId);
        if (blocker) {
          const offset = axis === 'x' ? entity.x - blocker.x : entity.y - blocker.y;
          if (Math.abs(offset) > 0.04) {
            return offset >= 0 ? [1, -1] : [-1, 1];
          }
        }
      }
      const hash = Math.round(entity.x * 3 + entity.y * 5 + selfId.charCodeAt(selfId.length - 1));
      return hash % 2 === 0 ? [1, -1] : [-1, 1];
    };

    const sideStep = Math.min(stepSize, 0.25);
    if (Math.abs(dy) >= Math.abs(dx)) {
      for (const s of pickSideOrder('x')) {
        const sideX = entity.x + s * sideStep;
        if (this.isStepWalkableAndUnblocked(sideX, entity.y, entity.x, entity.y, selfId).ok) {
          entity.x = sideX;
          entity.animFrame += animDelta * 0.55;
          if (direct.blockerId) {
            entity.avoidTargetId = direct.blockerId;
            entity.avoidSign = s;
          }
          return {
            progressed: true,
            sidestepped: true,
            reachedEnd: false,
            blockerId: direct.blockerId,
          };
        }
      }
    } else {
      for (const s of pickSideOrder('y')) {
        const sideY = entity.y + s * sideStep;
        if (this.isStepWalkableAndUnblocked(entity.x, sideY, entity.x, entity.y, selfId).ok) {
          entity.y = sideY;
          entity.animFrame += animDelta * 0.55;
          if (direct.blockerId) {
            entity.avoidTargetId = direct.blockerId;
            entity.avoidSign = s;
          }
          return {
            progressed: true,
            sidestepped: true,
            reachedEnd: false,
            blockerId: direct.blockerId,
          };
        }
      }
    }

    return { progressed: false, sidestepped: false, reachedEnd: false, blockerId: direct.blockerId };
  }

  private advanceEntityPath(
    entity: { x: number; y: number; path: Array<{ x: number; y: number }>; facing: Direction; animFrame: number; speed: number },
    dt: number,
  ) {
    if (entity.path.length === 0) return;
    const res = this.stepAlongPathWithCollision(entity, entity.speed * dt, dt * 7, this.player.id);
    if (!res.progressed && res.blockerId) {
      entity.path = [];
    }
  }

  private advanceVillagerPath(rt: VillagerRuntime, speed: number, dt: number): boolean {
    if (rt.path.length === 0) return false;
    if (!isTileWalkable(this.map, Math.round(rt.x), Math.round(rt.y))) {
      const safe = findNearestWalkableTile(this.map, rt.x, rt.y);
      rt.x = safe.x;
      rt.y = safe.y;
    }
    const res = this.stepAlongPathWithCollision(rt, speed * dt, dt * 5, rt.id);
    const now = this.now();

    if (res.progressed && !res.sidestepped) {
      rt.blockedTicks = 0;
      rt.sidestepTicks = 0;
      return !res.reachedEnd;
    }

    if (res.sidestepped) {
      rt.sidestepTicks = (rt.sidestepTicks ?? 0) + 1;
      // Throttle A* reroutes while sidestepping so villagers do not 60Hz ping-pong around each other
      if (
        res.blockerId &&
        rt.path.length > 0 &&
        (rt.sidestepTicks === 4 || rt.sidestepTicks === 12) &&
        now - (rt.lastRerouteAt ?? 0) >= 420
      ) {
        const goal = rt.path[rt.path.length - 1];
        const rerouted = findPath(
          this.map,
          { x: rt.x, y: rt.y },
          goal,
          this.getOccupiedTileSet(rt.id),
        );
        rt.lastRerouteAt = now;
        if (rerouted.length > 0) {
          rt.path = rerouted;
        }
      }
      if (rt.sidestepTicks > 20) {
        rt.path = [];
        rt.sidestepTicks = 0;
        rt.blockedTicks = 0;
        rt.avoidSign = undefined;
        rt.avoidTargetId = undefined;
        rt.lastMoveAt = now - 2200;
        return false;
      }
      return true;
    }

    rt.blockedTicks = (rt.blockedTicks ?? 0) + 1;

    // If a character blocked our initial step, reroute once cleanly with a cooldown
    if (
      res.blockerId &&
      rt.path.length > 0 &&
      rt.blockedTicks === 1 &&
      now - (rt.lastRerouteAt ?? 0) >= 420
    ) {
      const goal = rt.path[rt.path.length - 1];
      const rerouted = findPath(
        this.map,
        { x: rt.x, y: rt.y },
        goal,
        this.getOccupiedTileSet(rt.id),
      );
      rt.lastRerouteAt = now;
      if (rerouted.length > 0) {
        rt.path = rerouted;
      }
    }

    // Meeting another villager up close sparks a natural conversation when autoConverse is on
    if (
      res.blockerId &&
      res.blockerId !== this.player.id &&
      this.modelSettings.autoConverse &&
      !this.holdStory &&
      !rt.activeConversationId
    ) {
      const otherRt = this.runtimes.get(res.blockerId);
      if (
        otherRt &&
        !otherRt.activeConversationId &&
        otherRt.state !== 'thinking' &&
        otherRt.state !== 'speaking' &&
        now - rt.lastThinkAt >= 6000 &&
        now - otherRt.lastThinkAt >= 6000
      ) {
        rt.path = [];
        otherRt.path = [];
        rt.blockedTicks = 0;
        rt.sidestepTicks = 0;
        rt.avoidSign = undefined;
        rt.avoidTargetId = undefined;
        this.startAutonomousConversation(rt.id, otherRt.id);
        return false;
      }
    }

    // Reroute cleanly around persistent obstacles instead of staying frozen
    if ((rt.blockedTicks === 6 || rt.blockedTicks === 12) && now - (rt.lastRerouteAt ?? 0) >= 350) {
      const goal = rt.path[rt.path.length - 1];
      if (goal) {
        const distToGoal = Math.hypot(goal.x - rt.x, goal.y - rt.y);
        if (distToGoal < 1.35) {
          rt.path = [];
          rt.blockedTicks = 0;
          rt.sidestepTicks = 0;
          return false;
        }
        const rerouted = findPath(
          this.map,
          { x: rt.x, y: rt.y },
          goal,
          this.getOccupiedTileSet(rt.id),
        );
        rt.lastRerouteAt = now;
        if (rerouted.length > 0) {
          rt.path = rerouted;
          return true;
        }
      }
    }

    if (rt.blockedTicks > 18) {
      rt.path = [];
      rt.blockedTicks = 0;
      rt.sidestepTicks = 0;
      rt.avoidSign = undefined;
      rt.avoidTargetId = undefined;
      // Shorten wait before next autonomous move so villager immediately picks a clear path
      rt.lastMoveAt = now - 2200;
      return false;
    }
    return true;
  }

  private runAutonomousDecisions() {
    const now = this.now();
    const runtimesList = [...this.runtimes.values()];

    // 1. Pair nearby villagers (idle OR walking) so passersby stop and interact visibly
    if (this.modelSettings.autoConverse && !this.holdStory) {
      for (let i = 0; i < runtimesList.length; i++) {
        const a = runtimesList[i];
        if (
          a.activeConversationId ||
          a.state === 'thinking' ||
          a.state === 'speaking' ||
          a.state === 'listening'
        ) {
          continue;
        }
        const lastThinkSim = this.lastThinkSimMs.get(a.id) ?? -9999;
        if (this.simTimeMs - lastThinkSim < 10500 || now - a.lastThinkAt < 3500) continue;

        for (let j = i + 1; j < runtimesList.length; j++) {
          const b = runtimesList[j];
          if (
            b.activeConversationId ||
            b.state === 'thinking' ||
            b.state === 'speaking' ||
            b.state === 'listening'
          ) {
            continue;
          }
          const bThinkSim = this.lastThinkSimMs.get(b.id) ?? -9999;
          if (this.simTimeMs - bThinkSim < 10500 || now - b.lastThinkAt < 3500) continue;

          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist <= 3.8 && this.rng() < 0.65) {
            this.lastThinkSimMs.set(a.id, this.simTimeMs);
            this.lastThinkSimMs.set(b.id, this.simTimeMs);
            this.startAutonomousConversation(a.id, b.id);
            break;
          }
        }
      }
    }

    // 2. Westworld-style ongoing world-session motivation -> physical pathing
    for (const rt of runtimesList) {
      if (rt.state !== 'idle' || rt.activeConversationId || rt.path.length > 0) continue;
      if (this.planningVillagers.has(rt.id)) continue;
      const lastMoveSim = this.lastMoveSimMs.get(rt.id) ?? -9999;
      if (this.simTimeMs - lastMoveSim < 4200 + this.rng() * 4400) continue;

      const cfg = this.configs.get(rt.id);
      if (!cfg) continue;

      this.planningVillagers.add(rt.id);
      this.lastMoveSimMs.set(rt.id, this.simTimeMs);
      void this.planNextVillagerAction(cfg, rt).finally(() => {
        this.planningVillagers.delete(rt.id);
      });
    }
  }

  setFocalWorldline(targetId: string | 'traveler') {
    const resolved =
      targetId !== 'traveler' && this.runtimes.has(targetId) ? targetId : 'traveler';
    if (this.focalWorldlineId === resolved) return;
    this.focalWorldlineId = resolved;
    this.mind.refreshActiveSpatialMix();
    const label =
      resolved === 'traveler'
        ? this.player.name
        : this.configs.get(resolved)?.name ?? resolved;
    this.mind.log({
      channel: 'sim',
      level: 'info',
      title: `Worldline POV: ${label}`,
      detail: `Scribe and spatial audio listener hopped to ${label}'s point of view.`,
    });
    this.notify(true);
  }

  getListenerPosition(): { x: number; y: number; label: string; villagerId?: string } {
    if (this.focalWorldlineId !== 'traveler') {
      const rt = this.runtimes.get(this.focalWorldlineId);
      const cfg = this.configs.get(this.focalWorldlineId);
      if (rt && cfg) {
        return { x: rt.x, y: rt.y, label: cfg.name, villagerId: cfg.id };
      }
    }
    return { x: this.player.x, y: this.player.y, label: this.player.name };
  }

  private async planNextVillagerAction(cfg: VillagerConfig, rt: VillagerRuntime) {
    const now = this.now();
    const others = [...this.configs.values()].filter((v) => v.id !== cfg.id);
    const landmarks = this.getLandmarks().map((l) => l.label);

    const decision = await this.mind.decideVillagerNextAction({
        world: this.world,
      villager: cfg,
      runtime: rt,
      otherNames: others.map((v) => v.name),
      landmarkNames: landmarks,
      settings: this.modelSettings,
    });

    if (rt.activeConversationId || rt.state !== 'idle') {
      rt.lastMoveAt = this.now();
      return;
    }

    let safeGoal: { x: number; y: number } | null = null;
    if (decision.action === 'talk' && decision.targetName) {
      const targetCfg = others.find(
        (v) => v.name.toLowerCase() === decision.targetName!.toLowerCase(),
      );
      const targetRt = targetCfg ? this.runtimes.get(targetCfg.id) : undefined;
      if (targetRt) {
        safeGoal = this.findAdjacentStandTile(targetRt.x, targetRt.y, rt.id);
      }
    } else if (decision.action === 'visit' && decision.targetName) {
      const targetNorm = decision.targetName.trim().replace(/^#/, '').toLowerCase();
      const lm = this.getLandmarks().find(
        (l) =>
          (l.tag && l.tag.toLowerCase() === targetNorm) ||
          l.label.toLowerCase() === targetNorm ||
          l.label.toLowerCase().includes(targetNorm),
      );
      const place = lm ?? this.findPlaceForText(`#${decision.targetName.trim().replace(/^#/, '')} ${decision.targetName}`);
      if (place) {
        safeGoal = this.findAdjacentStandTile(place.x, place.y, rt.id);
      }
    }

    if (
      !safeGoal ||
      (safeGoal.x === Math.round(rt.x) && safeGoal.y === Math.round(rt.y))
    ) {
      const tx = Math.round(rt.x + (this.rng() > 0.5 ? 1 : -1) * (3 + this.rng() * 5));
      const ty = Math.round(rt.y + (this.rng() > 0.5 ? 1 : -1) * (2 + this.rng() * 5));
      safeGoal = findNearestWalkableTile(this.map, tx, ty);
    }

    const occupied = this.getOccupiedTileSet(rt.id);
    let path = findPath(this.map, { x: rt.x, y: rt.y }, safeGoal, occupied);
    if (path.length === 0) {
      // Retry without dynamic blockers so narrow corridors do not paralyze movement
      path = findPath(this.map, { x: rt.x, y: rt.y }, safeGoal);
    }
    if (path.length === 0) {
      const altGoal = findNearestWalkableTile(
        this.map,
        Math.round(rt.x + (this.rng() * 12 - 6)),
        Math.round(rt.y + (this.rng() * 10 - 5)),
      );
      path = findPath(this.map, { x: rt.x, y: rt.y }, altGoal);
    }
    rt.currentIntention = decision.motive;
    rt.activityLabel = decision.motive;
    rt.lastMoveAt = now;

    if (path.length > 0) {
      rt.path = path;
      rt.state = 'walking';
      this.appendWorldEvent(rt, `Decided: ${decision.motive}`);
      if (!isTextTooSimilar(decision.motive, rt.recentUtterances ?? [], 0.52)) {
        rt.recentUtterances = [...(rt.recentUtterances ?? []), decision.motive].slice(-6);
        const nowBubble = this.now();
        rt.currentThoughtBubble = {
          text: decision.motive,
          startedAt: nowBubble,
          expiresAt: nowBubble + computeBubbleDurationMs(decision.motive, 4800, 12000),
        };
      }
      if (this.modelSettings.eavesdropThoughts && this.modelSettings.proximityRadiusTiles > 0) {
        const thoughtResolver = () => {
          const listener = this.getListenerPosition();
          return computeSpatialMix(
            rt.x,
            rt.y,
            listener.x,
            listener.y,
            this.modelSettings.proximityRadiusTiles,
          );
        };
        const mix = thoughtResolver();
        if (mix.inRange) {
          void this.mind.speakThought(decision.motive, cfg, this.modelSettings, thoughtResolver);
        }
      }
    } else {
      // Avoid waiting full idle cooldown if pathfinding yielded empty
      rt.lastMoveAt = now - 2200;
    }
    this.notify();
  }

  /**
   * Unsticks any wedged/idle villagers and sends non-conversing residents
   * walking toward spread-out open destinations across the village.
   */
  scatterVillagers() {
    const now = this.now();
    const list = Array.from(this.runtimes.values());
    const usedGoals = new Set<string>();
    const spawnPoints = this.map.spawnPoints;

    for (let i = 0; i < list.length; i++) {
      const rt = list[i];
      if (rt.activeConversationId) continue;

      if (!isTileWalkable(this.map, Math.round(rt.x), Math.round(rt.y))) {
        const safe = findNearestWalkableTile(this.map, rt.x, rt.y);
        rt.x = safe.x;
        rt.y = safe.y;
      }

      const sp =
        spawnPoints.length > 0
          ? spawnPoints[(i * 2 + Math.floor(this.rng() * spawnPoints.length)) % spawnPoints.length]
          : undefined;
      const offsetX = Math.round(this.rng() * 10 - 5);
      const offsetY = Math.round(this.rng() * 8 - 4);
      const rawGoalX = sp ? sp.x + offsetX : Math.round(rt.x + (this.rng() * 14 - 7));
      const rawGoalY = sp ? sp.y + offsetY : Math.round(rt.y + (this.rng() * 12 - 6));
      let goal = findNearestWalkableTile(this.map, rawGoalX, rawGoalY);

      if (usedGoals.has(`${goal.x},${goal.y}`) || (goal.x === Math.round(rt.x) && goal.y === Math.round(rt.y))) {
        goal = findNearestWalkableTile(
          this.map,
          rawGoalX + (i % 2 === 0 ? 4 : -4),
          rawGoalY + (i % 3 === 0 ? 3 : -3),
        );
      }
      usedGoals.add(`${goal.x},${goal.y}`);

      const occupied = this.getOccupiedTileSet(rt.id);
      let path = findPath(this.map, { x: rt.x, y: rt.y }, goal, occupied);
      if (path.length === 0) {
        path = findPath(this.map, { x: rt.x, y: rt.y }, goal);
      }

      rt.blockedTicks = 0;
      if (path.length > 0) {
        rt.path = path;
        rt.state = 'walking';
        rt.lastMoveAt = now;
        rt.currentIntention = sp ? `Heading out near ${sp.label}` : `Exploring ${placeName(this.world)}`;
        rt.activityLabel = rt.currentIntention;
      }
    }
    this.notify(true);
  }

  /**
   * Where a character first appears. Their home tile, when it lies in this world's village;
   * otherwise (a cast authored for another map) the place their story names, or one of the
   * world's places, so nobody begins alone in an empty corner.
   */
  private startingSpotFor(v: VillagerConfig): { x: number; y: number } {
    const places = this.map.pointsOfInterest ?? [];
    if (!places.length) return v.homeTile;
    const nearest = Math.min(...places.map((p) => Math.hypot(p.x - v.homeTile.x, p.y - v.homeTile.y)));
    const reach = Math.max(10, Math.min(this.map.width, this.map.height) * 0.18);
    if (nearest <= reach) return v.homeTile;
    const named = this.findPlaceForText(`${v.plan} ${v.identity}`);
    if (named) return named;
    let h = 0;
    for (const c of v.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return places[h % places.length];
  }

  /**
   * The place in this world a piece of text points to. A tag written for another world
   * ("#LamiaWell") is read as its words ("Lamia", "Well") and matched to a place sharing one
   * ("Slivovo well"), so a cast authored for one map still finds its way in another.
   */
  private findPlaceForText(text: string): { label: string; tag?: string; x: number; y: number } | undefined {
    const places = (this.map.pointsOfInterest ?? []).map((p) => ({ label: p.label, tag: p.tag, x: p.x, y: p.y }));
    if (!places.length || !text.trim()) return undefined;
    const lower = text.toLowerCase();
    const tags = [...text.matchAll(/#([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    for (const tag of tags) {
      const exact = places.find((p) => p.tag?.toLowerCase() === tag.toLowerCase());
      if (exact) return exact;
    }
    const wordsOf = (s: string) =>
      s
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3);
    const STOP = new Set(['the', 'village', 'square', 'lower', 'upper', 'house', 'place']);
    const placeWords = places.map((p) => new Set(wordsOf(`${p.label} ${p.tag ?? ''}`).filter((w) => !STOP.has(w))));
    // A tag's last word names the kind of place ("Well" in "LamiaWell"): match on it first.
    for (const tag of tags) {
      const words = wordsOf(tag).filter((w) => !STOP.has(w));
      for (const w of [...words].reverse()) {
        const i = placeWords.findIndex((set) => set.has(w));
        if (i >= 0) return places[i];
      }
    }
    const byLabel = places.find((p) => lower.includes(p.label.toLowerCase()));
    if (byLabel) return byLabel;
    const words = wordsOf(text).filter((w) => !STOP.has(w));
    const i = placeWords.findIndex((set) => words.some((w) => set.has(w)));
    return i >= 0 ? places[i] : undefined;
  }

  private getLandmarks(): Array<{ label: string; tag?: string; x: number; y: number; description?: string }> {
    const pois = (this.map.pointsOfInterest ?? []).map((p) => ({
      label: p.label,
      tag: p.tag,
      x: p.x,
      y: p.y,
      description: p.description,
    }));
    const spawns = this.map.spawnPoints.map((s) => ({
      label: s.label,
      x: s.x,
      y: s.y,
    }));
    return [...pois, ...spawns];
  }

  private getNearestLandmarkName(x: number, y: number): string {
    const landmarks = this.getLandmarks();
    if (landmarks.length === 0) return this.world.fallbackLandmark;
    let best = landmarks[0];
    let bestDist = Infinity;
    for (const lm of landmarks) {
      const d = Math.hypot(lm.x - x, lm.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = lm;
      }
    }
    return best.label;
  }

  private async emitNarrationTurn(
    conv: Conversation,
    text: string,
    speakAudio: boolean,
    spatialResolver?: () => SpatialMix,
    source: ChatMessage['source'] = 'story-sim',
  ): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    this.noticeWellWater(clean);
    this.pushConversationMessage(conv, {
      id: `msg-nar-${this.now()}-${this.rng().toString(36).slice(2, 6)}`,
      senderId: 'narrator',
      senderName: this.modelSettings.narratorName.trim() || 'Scribe',
      text: clean,
      timestamp: this.now(),
      kind: 'narration',
      source,
    });
    conv.updatedAt = this.now();
    this.notify(true);

    if (speakAudio && this.modelSettings.narratorEnabled) {
      const mix = spatialResolver?.();
      if (!spatialResolver || mix?.inRange) {
        await this.mind.speakNarration(clean, this.modelSettings, spatialResolver);
      }
    }
  }

  public async runConversationBetween(idA: string, idB: string): Promise<Conversation | undefined> {
    return this.startAutonomousConversation(idA, idB);
  }

  private async startAutonomousConversation(idA: string, idB: string): Promise<Conversation | undefined> {
    const rtA = this.runtimes.get(idA);
    const rtB = this.runtimes.get(idB);
    const cfgA = this.configs.get(idA);
    const cfgB = this.configs.get(idB);
    if (!rtA || !rtB || !cfgA || !cfgB) return undefined;

    // A villager can only be in one conversation at a time.
    if (rtA.activeConversationId || rtB.activeConversationId) return undefined;
    const convId = `conv-${this.now()}-${this.rng().toString(36).slice(2, 6)}`;

    const conv: Conversation = {
      id: convId,
      participantIds: [idA, idB],
      messages: [],
      startedAt: this.now(),
      updatedAt: this.now(),
      active: true,
    };
    this.conversations = [conv, ...this.conversations].slice(0, 40);

    rtA.activeConversationId = convId;
    rtB.activeConversationId = convId;
    rtA.path = [];
    rtB.path = [];
    rtA.facing = computeFacing(rtA, rtB, rtA.facing);
    rtB.facing = computeFacing(rtB, rtA, rtB.facing);
    rtA.state = 'conversing';
    rtB.state = 'conversing';
    rtA.activityLabel = `Chatting with ${cfgB.name}`;
    rtB.activityLabel = `Chatting with ${cfgA.name}`;
    this.notify(true);

    const midpointResolver = () => {
      const listener = this.getListenerPosition();
      return computeSpatialMix(
        (rtA.x + rtB.x) / 2,
        (rtA.y + rtB.y) / 2,
        listener.x,
        listener.y,
        this.modelSettings.proximityRadiusTiles,
      );
    };

    try {
      const eavesdropEnabled = this.modelSettings.proximityRadiusTiles > 0;
      const hearSpeech = eavesdropEnabled && this.modelSettings.eavesdropSpeech;
      const hearThoughts = eavesdropEnabled && this.modelSettings.eavesdropThoughts;
      const landmarkName = this.getNearestLandmarkName((rtA.x + rtB.x) / 2, (rtA.y + rtB.y) / 2);
      await this.whenRunning();
      if (this.modelSettings.narratorEnabled && this.modelSettings.narrateEvents) {
        const introBeat = await this.mind.generateSceneBeat({
        world: this.world,
        cast: this.castPronouns(),
          phase: 'opening',
          villagerA: cfgA,
          runtimeA: rtA,
          villagerB: cfgB,
          runtimeB: rtB,
          landmarkName,
          settings: this.modelSettings,
        });
        this.appendWorldEvent(rtA, `Scene near ${landmarkName}: ${introBeat}`);
        this.appendWorldEvent(rtB, `Scene near ${landmarkName}: ${introBeat}`);
        const beatStartedSimMs = this.simTimeMs;
        await this.emitNarrationTurn(
          conv,
          introBeat,
          hearSpeech,
          midpointResolver,
        );
        await this.paceLine(introBeat, beatStartedSimMs);
      }

      const turns: Array<[VillagerConfig, VillagerRuntime, VillagerConfig]> = [
        [cfgA, rtA, cfgB],
        [cfgB, rtB, cfgA],
        [cfgA, rtA, cfgB],
      ];

      for (const [speakerCfg, speakerRt, partnerCfg] of turns) {
        await this.whenRunning();
        if (!this.runtimes.has(speakerCfg.id) || !this.runtimes.has(partnerCfg.id)) break;
        speakerRt.state = 'thinking';
        this.notify(true);

        const resolver = () => {
          const listener = this.getListenerPosition();
          return computeSpatialMix(
            speakerRt.x,
            speakerRt.y,
            listener.x,
            listener.y,
            this.modelSettings.proximityRadiusTiles,
          );
        };

        const turnStartedSimMs = this.simTimeMs;
        await this.runVillagerSpeechTurn({
          conv,
          speakerCfg,
          speakerRt,
          partnerName: partnerCfg.name,
          hearSpeech,
          hearThoughts,
          speakReasoningAudio: eavesdropEnabled,
          minBubbleMs: 5800,
          maxBubbleMs: 16000,
          restingState: 'conversing',
          resolver,
        });
        const spokenLine =
          [...conv.messages].reverse().find((m) => m.senderId === speakerCfg.id && m.kind !== 'thought')?.text ?? '';
        await this.paceLine(spokenLine, turnStartedSimMs);

        await this.sleep(400);
      }
      await this.whenRunning();

      // Reflect short conversation into memory for both villagers
      const transcript = conv.messages
        .filter((m) => m.kind !== 'narration')
        .map((m) => `${m.senderName}: ${m.text}`)
        .join('\n');
      const memA = await this.mind.reflectMemory({
        villager: cfgA,
        transcript,
        settings: this.modelSettings,
      });
      this.pushVillagerMemory(rtA, {
        id: `mem-${this.now()}-a`,
        timestamp: this.now(),
        importance: 6,
        kind: 'conversation',
        summary: memA,
      });
      this.appendWorldEvent(rtA, `Talked with ${cfgB.name}: ${memA}`);
      const firstSpoken = conv.messages.find((m) => m.kind !== 'narration');
      const bSummary = `Talked with ${cfgA.name}: ${firstSpoken?.text.slice(0, 64) ?? ''}`;
      this.pushVillagerMemory(rtB, {
        id: `mem-${this.now()}-b`,
        timestamp: this.now(),
        importance: 6,
        kind: 'conversation',
        summary: bSummary,
      });
      this.appendWorldEvent(rtB, bSummary);

      if (this.modelSettings.narratorEnabled && this.modelSettings.narrateEvents) {
        const closing = await this.mind.generateSceneBeat({
        world: this.world,
        cast: this.castPronouns(),
          phase: 'closing',
          villagerA: cfgA,
          runtimeA: rtA,
          villagerB: cfgB,
          runtimeB: rtB,
          landmarkName,
          history: conv.messages,
          settings: this.modelSettings,
        });
        this.appendWorldEvent(rtA, `Aftermath: ${closing}`);
        this.appendWorldEvent(rtB, `Aftermath: ${closing}`);
        const closingStartedSimMs = this.simTimeMs;
        await this.emitNarrationTurn(
          conv,
          closing,
          hearSpeech,
          midpointResolver,
        );
        await this.paceLine(closing, closingStartedSimMs);
      }
      return conv;
    } catch {
      // Ignore transient errors in background chatter
    } finally {
      conv.active = false;
      for (const [rt, cfg] of [
        [rtA, cfgA],
        [rtB, cfgB],
      ] as const) {
        if (rt.activeConversationId === convId) {
          rt.activeConversationId = undefined;
          rt.state = 'idle';
          rt.activityLabel = rt.currentIntention || cfg.plan;
          rt.lastThinkAt = this.now();
          rt.lastMoveAt = this.now();
        }
      }
      this.notify(true);
    }
  }

  getOrCreateHumanConversation(villagerId: string): Conversation {
    const existing = this.conversations.find(
      (c) =>
        c.active &&
        c.participantIds.includes(villagerId) &&
        c.participantIds.includes(this.player.id),
    );
    if (existing) return existing;

    const conv: Conversation = {
      id: `conv-human-${villagerId}-${this.now()}`,
      participantIds: [this.player.id, villagerId],
      messages: [],
      startedAt: this.now(),
      updatedAt: this.now(),
      active: true,
    };
    this.conversations = [conv, ...this.conversations].slice(0, MAX_CONVERSATIONS);
    return conv;
  }

  private buildSceneContext(focus?: { x: number; y: number }): string {
    const listener = this.getListenerPosition();
    const focal = focus ?? { x: listener.x, y: listener.y };
    const focalLandmark = this.getNearestLandmarkName(focal.x, focal.y);
    const lines: string[] = [
      `Active Worldline POV: ${listener.label}${listener.villagerId ? ' (character perspective)' : ' (traveler perspective)'}`,
      `Focal location: ${focalLandmark}`,
    ];
    if (listener.villagerId) {
      const povCfg = this.configs.get(listener.villagerId);
      const povRt = this.runtimes.get(listener.villagerId);
      if (povCfg && povRt) {
        const recentMems = povRt.memories
          .slice(-3)
          .map((m) => m.summary)
          .join(' | ');
        lines.push(
          `Focal character inner lens (${povCfg.name}): motive="${povRt.currentIntention || povCfg.plan}"${recentMems ? `; memories=[${recentMems}]` : ''}`,
        );
      }
    }
    if (this.wellWater) lines.push(this.wellWater === 'flowing' ? 'The well flows again: the water has come back.' : 'The well has run dry.');
    const pois = this.map.pointsOfInterest ?? [];
    if (pois.length > 0) {
      lines.push(
        `Points of interest: ${pois.map((p) => `${p.label}${p.description ? ` (${p.description})` : ''}`).join(', ')}`,
      );
    }

    const entries = [...this.configs.values()]
      .map((cfg) => {
        const rt = this.runtimes.get(cfg.id);
        if (!rt) return null;
        const dist = Math.hypot(rt.x - focal.x, rt.y - focal.y);
        return { cfg, rt, dist };
      })
      .filter((x): x is { cfg: VillagerConfig; rt: VillagerRuntime; dist: number } => Boolean(x))
      .sort((a, b) => a.dist - b.dist);

    lines.push('Nearby characters:');
    for (const { cfg, rt, dist } of entries.slice(0, 5)) {
      const near = this.getNearestLandmarkName(rt.x, rt.y);
      const lastEvent = rt.worldFeed?.slice(-1)[0];
      const proximity = dist <= 12 ? 'right nearby' : `${Math.round(dist)}t away`;
      lines.push(
        `- ${cfg.name} (${proximity}, near ${near}, ${rt.state}): ${rt.currentIntention || rt.activityLabel}${lastEvent ? ` | latest: ${lastEvent}` : ''}`,
      );
    }

    const recentFlow = this.conversations
      .slice(0, 3)
      .flatMap((c) => c.messages.slice(-2))
      .filter((m) => m.text.trim().length > 0)
      .slice(0, 4);
    if (recentFlow.length > 0) {
      lines.push('Recent nearby flow:');
      for (const m of recentFlow) {
        lines.push(`> ${m.senderName}: ${m.text.slice(0, 90)}`);
      }
    }

    return lines.join('\n');
  }

  private applyWorldDirection(
    _cfg: VillagerConfig,
    rt: VillagerRuntime,
    userText: string,
    slotIndex = 0,
  ) {
    this.appendWorldEvent(rt, `${this.player.name} said: "${userText.slice(0, 90)}"`);
    this.pushVillagerMemory(rt, {
      id: `mem-dir-${this.now()}-${slotIndex}`,
      timestamp: this.now(),
      importance: 6,
      kind: 'observation',
      summary: `${this.player.name} instructed: "${userText.slice(0, 80)}"`,
    });
    const lower = userText.toLowerCase();

    // Let natural language "@Character / @all go talk to Bram / visit #Plaza / scatter" steer motivation + movement
    const directedMotion = /\b(go|head|walk|meet|find|talk|visit|check|gather|move|wander|scatter|roam|explore|disperse|come|patrol|spread)\b|#[a-z0-9_-]+/i.test(
      userText,
    );
    if (!directedMotion) return;

    const findBestPath = (goal: { x: number; y: number }) => {
      const p = findPath(this.map, { x: rt.x, y: rt.y }, goal, this.getOccupiedTileSet(rt.id));
      return p.length > 0 ? p : findPath(this.map, { x: rt.x, y: rt.y }, goal);
    };

    const otherTarget = [...this.configs.values()].find(
      (other) => other.id !== rt.id && lower.includes(other.name.toLowerCase()),
    );
    if (otherTarget) {
      const otherRt = this.runtimes.get(otherTarget.id);
      if (otherRt) {
        const goal = this.findAdjacentStandTile(otherRt.x, otherRt.y, rt.id);
        const path = findBestPath(goal);
        rt.currentIntention = `Heading to speak with ${otherTarget.name}`;
        rt.activityLabel = rt.currentIntention;
        if (path.length > 0) {
          rt.path = path;
          rt.state = 'walking';
        }
        return;
      }
    }

    const pois = this.map.pointsOfInterest ?? [];
    const hashTags = [...userText.matchAll(/#([a-z0-9_-]+)/gi)].map((m) => m[1].toLowerCase());
    const poiByHash =
      hashTags.map((tag) => pois.find((p) => p.tag.toLowerCase() === tag)).find((p) => Boolean(p)) ??
      (hashTags.length ? this.findPlaceForText(userText) : undefined);

    const landmark =
      poiByHash ??
      this.getLandmarks().find((lm) => {
        const words = lm.label.toLowerCase().split(/\s+/);
        return (
          (lm.tag && lower.includes(`#${lm.tag.toLowerCase()}`)) ||
          lower.includes(lm.label.toLowerCase()) ||
          words.some((w) => w.length > 3 && lower.includes(w))
        );
      });
    if (landmark) {
      // Spread multi-character arrivals around the landmark so they don't collide on one tile
      const ringOffsets = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 2, dy: 1 },
        { dx: -2, dy: -1 },
      ];
      const off = ringOffsets[slotIndex % ringOffsets.length];
      const goal = findNearestWalkableTile(this.map, landmark.x + off.dx, landmark.y + off.dy);
      const path = findBestPath(goal);
      rt.currentIntention = `Headed to ${landmark.label}`;
      rt.activityLabel = rt.currentIntention;
      if (path.length > 0) {
        rt.path = path;
        rt.state = 'walking';
      }
      return;
    }

    if (/\b(come|here|me|traveler)\b/i.test(lower)) {
      const ringOffsets = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
        { dx: 2, dy: 1 },
        { dx: -2, dy: 1 },
      ];
      const off = ringOffsets[slotIndex % ringOffsets.length];
      const goal = findNearestWalkableTile(this.map, this.player.x + off.dx, this.player.y + off.dy);
      const path = findBestPath(goal);
      rt.currentIntention = `Approaching ${this.player.name}`;
      rt.activityLabel = rt.currentIntention;
      if (path.length > 0) {
        rt.path = path;
        rt.state = 'walking';
      }
      return;
    }

    // General movement prompt (e.g. "@all scatter / wander / move around")
    const sp =
      this.map.spawnPoints.length > 0
        ? this.map.spawnPoints[(slotIndex + Math.floor(this.rng() * this.map.spawnPoints.length)) % this.map.spawnPoints.length]
        : undefined;
    const goal = findNearestWalkableTile(
      this.map,
      Math.round((sp?.x ?? rt.x) + (slotIndex % 2 === 0 ? 3 : -3)),
      Math.round((sp?.y ?? rt.y) + (slotIndex % 3 === 0 ? 2 : -2)),
    );
    const path = findBestPath(goal);
    rt.currentIntention = sp ? `Roaming paths near ${sp.label}` : `Moving across ${placeName(this.world)}`;
    rt.activityLabel = rt.currentIntention;
    if (path.length > 0) {
      rt.path = path;
      rt.state = 'walking';
    }
  }

  /**
   * Executes one villager dialogue turn with live token streaming and guarantees that
   * thoughts, stage beats, and spoken text are committed to the conversation log and UI
   * BEFORE voice playback begins (matching Scribe narration behavior).
   */
  private async runVillagerSpeechTurn(opts: {
    conv: Conversation;
    speakerCfg: VillagerConfig;
    speakerRt: VillagerRuntime;
    partnerName: string;
    hearSpeech: boolean;
    hearThoughts: boolean;
    speakReasoningAudio: boolean;
    minBubbleMs: number;
    maxBubbleMs: number;
    restingState: VillagerRuntime['state'];
    resolver: () => SpatialMix;
    speakDisplayFallback?: boolean;
    onBeforeVoice?: (spokenLine: string) => void;
  }): Promise<void> {
    const {
      conv,
      speakerCfg,
      speakerRt,
      partnerName,
      hearSpeech,
      hearThoughts,
      speakReasoningAudio,
      minBubbleMs,
      maxBubbleMs,
      restingState,
      resolver,
      speakDisplayFallback = false,
      onBeforeVoice,
    } = opts;

    const streamingMsg: ChatMessage = {
      id: `msg-v-${this.now()}-${this.rng().toString(36).slice(2, 6)}`,
      senderId: speakerCfg.id,
      senderName: speakerCfg.name,
      text: '',
      timestamp: this.now(),
      kind: 'speech',
      source: 'story-sim',
    };
    const historySnapshot = conv.messages.slice();
    this.pushConversationMessage(conv, streamingMsg);
    conv.updatedAt = this.now();
    this.notify(true);

    let rawStream = '';
    let notifiedFirstText = false;
    let preAudioCommitted = false;

    const commitSpeechIntoLog = (
      spokenLine: string,
      reasoning: string | undefined,
      source: ChatMessage['source'],
      durationMs: number,
      willSpeakNow: boolean,
    ) => {
      const nowSp = this.now();
      speakerRt.lastLatencyMs = durationMs;
      speakerRt.state = willSpeakNow ? 'speaking' : restingState;
      speakerRt.currentBubble = {
        text: spokenLine,
        startedAt: nowSp,
        expiresAt: nowSp + computeBubbleDurationMs(spokenLine, minBubbleMs, maxBubbleMs),
      };
      // Keep the speech message positioned after any pre-speech thought or narration beats.
      const idx = conv.messages.indexOf(streamingMsg);
      if (idx !== -1 && idx !== conv.messages.length - 1) {
        conv.messages.splice(idx, 1);
        conv.messages.push(streamingMsg);
      }
      streamingMsg.text = spokenLine;
      this.noticeWellWater(spokenLine);
      streamingMsg.reasoning = reasoning;
      streamingMsg.timestamp = nowSp;
      streamingMsg.kind = 'speech';
      streamingMsg.source = source;
      conv.updatedAt = nowSp;
      this.notify(true);
    };

    try {
      const res = await this.mind.generateVillagerReply({
        world: this.world,
        cast: this.castPronouns(),
        villager: speakerCfg,
        runtime: speakerRt,
        partnerName,
        history: historySnapshot,
        settings: this.modelSettings,
        speakSpatialResolver: hearSpeech ? resolver : undefined,
        onChunk: (chunk) => {
          rawStream += chunk;
          const liveParsed = parseDialogueAndNarration(rawStream, speakerCfg.name);
          const liveText = liveParsed.spoken || liveParsed.display;
          streamingMsg.text = liveText;
          streamingMsg.reasoning = liveParsed.reasoning.join('\n\n') || undefined;
          if (liveText) {
            const nowChunk = this.now();
            speakerRt.currentBubble = {
              text: liveText,
              startedAt: speakerRt.currentBubble?.startedAt ?? nowChunk,
              expiresAt: nowChunk + 8000,
            };
          }
          const isFirstText = !notifiedFirstText && Boolean(liveText);
          if (isFirstText) notifiedFirstText = true;
          this.notify(isFirstText);
        },
        onBeforeSpeak: (info) => {
          preAudioCommitted = true;
          const preParsed = parseDialogueAndNarration(info.text, speakerCfg.name);
          const preSpoken = preParsed.spoken || preParsed.display;
          const willSpeakNow = Boolean(hearSpeech && resolver().inRange && preSpoken);
          onBeforeVoice?.(preSpoken);
          commitSpeechIntoLog(
            preSpoken,
            preParsed.reasoning.join('\n\n') || undefined,
            info.source,
            info.durationMs,
            willSpeakNow,
          );
        },
      });

      const parsed = parseDialogueAndNarration(res.text, speakerCfg.name);
      const spokenLine = parsed.spoken || parsed.display;

      if (parsed.thoughts.length > 0) {
        const joinedThought = parsed.thoughts.join(' ');
        const nowTh = this.now();
        speakerRt.currentThoughtBubble = {
          text: joinedThought,
          startedAt: nowTh,
          expiresAt: nowTh + computeBubbleDurationMs(joinedThought, 5000, 14000),
        };
        if (this.modelSettings.eavesdropThoughts) {
          for (const thought of parsed.thoughts) {
            const thMsg: ChatMessage = {
              id: `msg-th-${this.now()}-${this.rng().toString(36).slice(2, 6)}`,
              senderId: speakerCfg.id,
              senderName: speakerCfg.name,
              text: thought,
              timestamp: this.now(),
              kind: 'thought',
              source: res.source,
            };
            const stIdx = conv.messages.indexOf(streamingMsg);
            conv.messages.splice(stIdx >= 0 ? stIdx : conv.messages.length, 0, thMsg);
            conv.updatedAt = this.now();
            this.notify(true);
            if (hearThoughts) {
              await this.mind.speakThought(thought, speakerCfg, this.modelSettings, resolver);
            }
          }
        }
      }

      if (parsed.narration.length > 0 && this.modelSettings.narratorEnabled) {
        for (const beat of parsed.narration) {
          const actionText = `${speakerCfg.name} ${beat.charAt(0).toLowerCase()}${beat.slice(1)}`;
          await this.emitNarrationTurn(
            conv,
            actionText,
            hearSpeech && !res.audioHandled,
            resolver,
            res.source,
          );
        }
      }

      const lineForTts = speakDisplayFallback ? spokenLine : parsed.spoken;
      const willSpeakTts = Boolean(
        hearSpeech && !res.audioHandled && lineForTts && resolver().inRange,
      );

      if (!preAudioCommitted) {
        onBeforeVoice?.(spokenLine);
        commitSpeechIntoLog(
          spokenLine,
          parsed.reasoning.join('\n\n') || undefined,
          res.source,
          res.durationMs,
          willSpeakTts,
        );
      } else if (parsed.thoughts.length > 0 || parsed.narration.length > 0) {
        commitSpeechIntoLog(
          spokenLine,
          parsed.reasoning.join('\n\n') || undefined,
          res.source,
          res.durationMs,
          willSpeakTts,
        );
      }

      if (hearSpeech && !res.audioHandled && lineForTts) {
        const mix = resolver();
        if (mix.inRange) {
          await this.mind.speakLine(lineForTts, speakerCfg, this.modelSettings, resolver);
        }
      }
      if (this.modelSettings.speakReasoning && parsed.reasoning.length > 0 && speakReasoningAudio) {
        const mix = resolver();
        if (mix.inRange) {
          await this.mind.speakLine(parsed.reasoning.join(' '), speakerCfg, this.modelSettings, resolver);
        }
      }
      speakerRt.state = restingState;
    } catch (err) {
      if (!streamingMsg.text.trim()) {
        const idx = conv.messages.indexOf(streamingMsg);
        if (idx !== -1) {
          conv.messages.splice(idx, 1);
          this.notify(true);
        }
      }
      throw err;
    }
  }

  private async executeVillagerReplyTurn(
    conv: Conversation,
    cfg: VillagerConfig,
    rt: VillagerRuntime,
    userText: string,
    speakReply: boolean,
  ): Promise<void> {
    const hadPathBeforeTurn = rt.path.length > 0;
    if (!hadPathBeforeTurn) {
      rt.facing = computeFacing(rt, this.player, rt.facing);
    }
    rt.state = 'thinking';
    rt.activityLabel = `Listening to ${this.player.name}`;
    this.notify(true);

    try {
      const resolver = () => {
        const listener = this.getListenerPosition();
        const mix = computeSpatialMix(
          rt.x,
          rt.y,
          listener.x,
          listener.y,
          Math.max(9, this.modelSettings.proximityRadiusTiles),
        );
        return {
          ...mix,
          gain: Math.max(0.35, mix.gain),
          inRange: true,
        };
      };

      const hearSpeech = speakReply && this.modelSettings.eavesdropSpeech;
      const hearThoughts = speakReply && this.modelSettings.eavesdropThoughts;

      await this.runVillagerSpeechTurn({
        conv,
        speakerCfg: cfg,
        speakerRt: rt,
        partnerName: this.player.name,
        hearSpeech,
        hearThoughts,
        speakReasoningAudio: speakReply,
        minBubbleMs: 6500,
        maxBubbleMs: 17000,
        restingState: 'idle',
        resolver,
        speakDisplayFallback: true,
        onBeforeVoice: (finalSpoken) => {
          const summary = `${this.player.name} said: "${userText.slice(0, 50)}". I replied: "${finalSpoken.slice(0, 55)}"`;
          this.pushVillagerMemory(rt, {
            id: `mem-u-${this.now()}`,
            timestamp: this.now(),
            importance: 7,
            kind: 'conversation',
            summary,
          });
          this.appendWorldEvent(rt, `Replied to ${this.player.name}: "${finalSpoken.slice(0, 64)}"`);
          rt.activityLabel = rt.currentIntention || cfg.plan;
        },
      });
    } finally {
      rt.state = rt.path.length > 0 ? 'walking' : 'idle';
      rt.lastThinkAt = this.now();
      this.notify(true);
    }
  }

  private async executeNarratorReplyTurn(
    conv: Conversation,
    userText: string,
    speakReply: boolean,
  ): Promise<void> {
    const narratorName = this.modelSettings.narratorName.trim() || 'Scribe';
    const streamingMsg: ChatMessage = {
      id: `msg-nar-${this.now()}-${this.rng().toString(36).slice(2, 5)}`,
      senderId: 'narrator',
      senderName: narratorName,
      text: '',
      timestamp: this.now(),
      kind: 'narration',
      source: 'story-sim',
    };
    this.pushConversationMessage(conv, streamingMsg);
    this.notify(true);

    let rawNarStream = '';
    const res = await this.mind.generateNarratorReply({
        world: this.world,
        cast: this.castPronouns(),
      prompt: userText,
      sceneContext: this.buildSceneContext(),
      history: conv.messages.slice(0, -1),
      settings: this.modelSettings,
      onChunk: (chunk) => {
        rawNarStream += chunk;
        const liveParsed = parseDialogueAndNarration(rawNarStream, narratorName);
        streamingMsg.text = liveParsed.display;
        streamingMsg.reasoning = liveParsed.reasoning.join('\n\n') || undefined;
        this.notify();
      },
    });

    const parsedNar = parseDialogueAndNarration(res.text, narratorName);
    streamingMsg.text = parsedNar.display;
    this.noticeWellWater(parsedNar.display);
    streamingMsg.reasoning = parsedNar.reasoning.join('\n\n') || undefined;
    streamingMsg.source = res.source;
    conv.updatedAt = this.now();
    this.notify(true);

    if (speakReply && this.modelSettings.narratorEnabled && streamingMsg.text.trim()) {
      await this.mind.speakNarration(streamingMsg.text, this.modelSettings);
    }
  }

  /** Speaks the Traveler's own line aloud, when that is switched on. */
  private async voicePlayerLine(text: string, speakReply: boolean): Promise<void> {
    if (!speakReply || !this.modelSettings.speakPlayerLines || !text.trim()) return;
    const traveler: VillagerConfig = {
      id: this.player.id,
      name: this.player.name,
      role: 'Traveler',
      spritesheetId: 'custom',
      accentColor: '#3b5b8c',
      identity: '',
      plan: '',
      voiceStyle: '',
      voice: this.modelSettings.playerVoice,
      homeTile: { x: 0, y: 0 },
      speed: 0,
    };
    await this.mind.speakLine(text, traveler, this.modelSettings);
  }

  async sendUserTextToVillager(
    villagerId: string,
    text: string,
    speakReply = true,
    voiceOwnLine = true,
  ): Promise<void> {
    const cfg = this.configs.get(villagerId);
    const rt = this.runtimes.get(villagerId);
    if (!cfg || !rt) return;
    if (voiceOwnLine) await this.voicePlayerLine(text, speakReply);

    const conv = this.getOrCreateHumanConversation(villagerId);
    this.pushConversationMessage(conv, {
      id: `msg-u-${this.now()}`,
      senderId: this.player.id,
      senderName: this.player.name,
      text,
      timestamp: this.now(),
      source: 'human-text',
    });
    conv.updatedAt = this.now();
    this.applyWorldDirection(cfg, rt, text);
    await this.executeVillagerReplyTurn(conv, cfg, rt, text, speakReply);
  }

  /**
   * Routes a message supporting @mentions (e.g. "@Taras ...", "@Scribe ...", or "@Olena @Taras ...").
   * Falls back to the active villager if no @mention is specified.
   */
  async sendUserAddressedMessage(
    activeTargetId: string | undefined,
    text: string,
    speakReply = true,
  ): Promise<{ focusedTargetId?: string }> {
    const targets = parseMentionTargets(
      text,
      Array.from(this.configs.values()),
      this.modelSettings,
    );
    await this.voicePlayerLine(text, speakReply);

    if (targets.length === 0) {
      if (activeTargetId === 'narrator') {
        const conv = this.getOrCreateHumanConversation('narrator');
        this.pushConversationMessage(conv, {
          id: `msg-u-${this.now()}`,
          senderId: this.player.id,
          senderName: this.player.name,
          text,
          timestamp: this.now(),
          source: 'human-text',
        });
        conv.updatedAt = this.now();
        await this.executeNarratorReplyTurn(conv, text, speakReply);
        return { focusedTargetId: 'narrator' };
      }
      if (activeTargetId) {
        await this.sendUserTextToVillager(activeTargetId, text, speakReply, false);
      }
      return { focusedTargetId: activeTargetId };
    }

    if (targets.length === 1 && targets[0].kind === 'villager') {
      await this.sendUserTextToVillager(targets[0].id, text, speakReply, false);
      return { focusedTargetId: targets[0].id };
    }

    const hostId =
      activeTargetId && (activeTargetId === 'narrator' || this.configs.has(activeTargetId))
        ? activeTargetId
        : targets[0].id;
    const conv = this.getOrCreateHumanConversation(hostId);
    this.pushConversationMessage(conv, {
      id: `msg-u-${this.now()}`,
      senderId: this.player.id,
      senderName: this.player.name,
      text,
      timestamp: this.now(),
      source: 'human-text',
    });
    conv.updatedAt = this.now();
    this.notify(true);

    // Apply instruction & pathing simultaneously to all targeted villagers first
    // so everyone @mentioned (or @all/@world) receives it and starts moving right away.
    const villagerTargets = targets.filter((t) => t.kind === 'villager');
    villagerTargets.forEach((target, idx) => {
      const cfg = this.configs.get(target.id);
      const rt = this.runtimes.get(target.id);
      if (cfg && rt) {
        this.applyWorldDirection(cfg, rt, text, idx);
      }
    });
    this.notify(true);

    const isWideBroadcast = /@(world|all|everyone|village)\b/i.test(text);
    let villagerRepliesLeft = isWideBroadcast && villagerTargets.length > 6 ? 4 : villagerTargets.length;

    for (const target of targets) {
      if (target.kind === 'narrator') {
        await this.executeNarratorReplyTurn(conv, text, speakReply);
      } else {
        if (villagerRepliesLeft <= 0) continue;
        const cfg = this.configs.get(target.id);
        const rt = this.runtimes.get(target.id);
        if (!cfg || !rt) continue;
        villagerRepliesLeft -= 1;
        await this.executeVillagerReplyTurn(conv, cfg, rt, text, speakReply);
      }
    }

    return {
      focusedTargetId:
        targets.length === 1 && targets[0].kind === 'narrator'
          ? activeTargetId || 'narrator'
          : hostId,
    };
  }

  async sendUserVoiceToVillager(villagerId: string, audioBuffer: AudioBuffer): Promise<void> {
    const cfg = this.configs.get(villagerId);
    const rt = this.runtimes.get(villagerId);
    if (!cfg || !rt) return;

    const conv = this.getOrCreateHumanConversation(villagerId);
    rt.path = [];
    rt.facing = computeFacing(rt, this.player, rt.facing);
    rt.state = 'listening';
    rt.activityLabel = 'Listening via LFM3-Omni-2B…';
    this.notify(true);

    const userMsg: ChatMessage = {
      id: `msg-uv-${this.now()}`,
      senderId: this.player.id,
      senderName: this.player.name,
      text: 'Transcribing voice…',
      timestamp: this.now(),
      source: 'human-voice',
      hasAudio: true,
    };
    const replyMsg: ChatMessage = {
      id: `msg-vo-${this.now()}`,
      senderId: cfg.id,
      senderName: cfg.name,
      text: '',
      timestamp: this.now(),
      source: 'lfm3-omni',
      hasAudio: true,
    };
    this.pushConversationMessage(conv, userMsg, replyMsg);
    this.notify(true);

    try {
      const res = await this.mind.converseWithVoice({
        world: this.world,
        villager: cfg,
        runtime: rt,
        audioBuffer,
        settings: this.modelSettings,
        onTextChunk: (chunk) => {
          replyMsg.text += chunk;
          rt.state = 'speaking';
          rt.currentBubble = { text: replyMsg.text, expiresAt: this.now() + 8000 };
          this.notify();
        },
      });
      userMsg.text = res.userTranscript;
      replyMsg.text = res.replyText;
      rt.lastLatencyMs = res.durationMs;
      rt.currentBubble = { text: res.replyText, expiresAt: this.now() + 7500 };
      this.pushVillagerMemory(rt, {
        id: `mem-ov-${this.now()}`,
        timestamp: this.now(),
        importance: 8,
        kind: 'conversation',
        summary: `Voice chat with ${this.player.name}: "${res.userTranscript.slice(0, 50)}"`,
      });
    } finally {
      rt.state = 'idle';
      rt.activityLabel = cfg.plan;
      rt.lastThinkAt = this.now();
      this.notify(true);
    }
  }
}
