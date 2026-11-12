import { computeSpatialMix, type SpatialMix } from '../ai/audioPipeline';
import { brainRouter, parseDialogueAndNarration } from '../ai/brainRouter';
import { computeFacing, findNearestWalkableTile, findPath, isTileWalkable } from './pathfinding';
import { ensureVillagerAppearanceSprite } from './spriteGenerator';
import type {
  ChatMessage,
  Conversation,
  Direction,
  ModelSettings,
  VillageMap,
  VillagerConfig,
  VillagerRuntime,
} from './types';

export interface MentionTarget {
  kind: 'narrator' | 'villager';
  id: string;
  name: string;
}

export const CHAR_COLLISION_RADIUS = 0.78;

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

export class VillageSimulation {
  public map: VillageMap;
  public configs: Map<string, VillagerConfig> = new Map();
  public runtimes: Map<string, VillagerRuntime> = new Map();
  public conversations: Conversation[] = [];
  public player: PlayerAvatar;
  public paused = false;
  public speedMultiplier = 1;
  public tickCount = 0;
  public fps = 60;
  public modelSettings: ModelSettings;

  private listeners = new Set<() => void>();
  private aiAccumulator = 0;
  private busyConversations = new Set<string>();
  private planningVillagers = new Set<string>();
  private lastNotifyAt = 0;

  constructor(
    map: VillageMap,
    villagers: VillagerConfig[],
    conversations: Conversation[],
    settings: ModelSettings,
  ) {
    this.map = map;
    this.modelSettings = settings;
    this.conversations = conversations;
    const spawn = map.spawnPoints[0] ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
    const safeSpawn = findNearestWalkableTile(map, spawn.x, spawn.y);
    this.player = {
      id: 'human-visitor',
      name: 'Traveler',
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

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(force = false) {
    const now = performance.now();
    if (!force && now - this.lastNotifyAt < 120) return;
    this.lastNotifyAt = now;
    for (const fn of this.listeners) fn();
  }

  updateSettings(settings: ModelSettings) {
    this.modelSettings = settings;
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

  syncVillagers(villagers: VillagerConfig[]) {
    const nextIds = new Set(villagers.map((v) => v.id));
    for (const oldId of this.runtimes.keys()) {
      if (!nextIds.has(oldId)) {
        this.runtimes.delete(oldId);
      }
    }
    this.configs.clear();

    for (const rawVillager of villagers) {
      const v = ensureVillagerAppearanceSprite(rawVillager);
      this.configs.set(v.id, v);
      const existing = this.runtimes.get(v.id);
      if (!existing) {
        const safe = findNearestWalkableTile(this.map, v.homeTile.x, v.homeTile.y);
        this.runtimes.set(v.id, {
          id: v.id,
          x: safe.x,
          y: safe.y,
          facing: 'down',
          path: [],
          state: 'idle',
          activityLabel: v.plan,
          currentIntention: v.plan,
          worldFeed: [`Entered Selo with purpose: ${v.plan}`],
          blockedTicks: 0,
          memories: [
            {
              id: `mem-init-${v.id}`,
              timestamp: Date.now(),
              importance: 5,
              kind: 'observation',
              summary: v.plan,
            },
          ],
          lastThinkAt: Date.now() - 4500 - Math.random() * 2500,
          lastMoveAt: Date.now() - 2000 - Math.random() * 2000,
          animFrame: 0,
        });
      }
    }
    this.notify(true);
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
    brainRouter.refreshActiveSpatialMix();

    if (this.paused) return;
    const dt = Math.min(0.1, rawDt) * this.speedMultiplier;
    this.tickCount++;

    const now = Date.now();
    for (const rt of this.runtimes.values()) {
      const cfg = this.configs.get(rt.id);
      if (!cfg) continue;

      if (rt.currentBubble && rt.currentBubble.expiresAt <= now) {
        rt.currentBubble = undefined;
      }

      if (rt.path.length > 0 && rt.state !== 'conversing' && rt.state !== 'thinking' && rt.state !== 'speaking') {
        rt.state = 'walking';
        const hasMore = this.advanceVillagerPath(rt, cfg.speed, dt);
        if (!hasMore && rt.path.length === 0) {
          rt.state = 'idle';
          rt.lastMoveAt = now;
        }
      } else if (rt.state === 'walking') {
        rt.state = 'idle';
      }
    }

    this.aiAccumulator += dt;
    if (this.aiAccumulator >= 1.1) {
      this.aiAccumulator = 0;
      this.runAutonomousDecisions();
      this.notify();
    }
  }

  private stepAlongPathWithCollision(
    entity: { x: number; y: number; path: Array<{ x: number; y: number }>; facing: Direction; animFrame: number },
    stepSize: number,
    animDelta: number,
    selfId: string,
  ): { progressed: boolean; reachedEnd: boolean; blockerId: string | null } {
    if (entity.path.length === 0) {
      return { progressed: false, reachedEnd: true, blockerId: null };
    }
    const next = entity.path[0];
    const dx = next.x - entity.x;
    const dy = next.y - entity.y;
    const dist = Math.hypot(dx, dy);
    entity.facing = computeFacing(entity, next, entity.facing);
    entity.animFrame += animDelta;

    const targetX = dist <= stepSize ? next.x : entity.x + (dx / dist) * stepSize;
    const targetY = dist <= stepSize ? next.y : entity.y + (dy / dist) * stepSize;

    const direct = this.isStepWalkableAndUnblocked(targetX, targetY, entity.x, entity.y, selfId);
    if (direct.ok) {
      entity.x = targetX;
      entity.y = targetY;
      if (dist <= stepSize) {
        entity.path.shift();
      }
      return { progressed: true, reachedEnd: entity.path.length === 0, blockerId: null };
    }

    // Try sliding along forward axes for wall corners (only when not colliding with a character,
    // otherwise axis slide can pull back toward a character we just sidestepped around)
    if (!direct.blockerId) {
      if (Math.abs(dx) > 0.05) {
        const slideX = entity.x + Math.sign(dx) * Math.min(stepSize, Math.abs(dx));
        if (this.isStepWalkableAndUnblocked(slideX, entity.y, entity.x, entity.y, selfId).ok) {
          entity.x = slideX;
          return { progressed: true, reachedEnd: false, blockerId: null };
        }
      }
      if (Math.abs(dy) > 0.05) {
        const slideY = entity.y + Math.sign(dy) * Math.min(stepSize, Math.abs(dy));
        if (this.isStepWalkableAndUnblocked(entity.x, slideY, entity.x, entity.y, selfId).ok) {
          entity.y = slideY;
          return { progressed: true, reachedEnd: false, blockerId: null };
        }
      }
    }

    // Perpendicular sidestep so characters never deadlock head-on along cardinal A* segments
    const pickSideOrder = (axis: 'x' | 'y'): [number, number] => {
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
          return { progressed: true, reachedEnd: false, blockerId: direct.blockerId };
        }
      }
    } else {
      for (const s of pickSideOrder('y')) {
        const sideY = entity.y + s * sideStep;
        if (this.isStepWalkableAndUnblocked(entity.x, sideY, entity.x, entity.y, selfId).ok) {
          entity.y = sideY;
          return { progressed: true, reachedEnd: false, blockerId: direct.blockerId };
        }
      }
    }

    return { progressed: false, reachedEnd: false, blockerId: direct.blockerId };
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

    // If a character blocked our direct step, immediately reroute around their tile if we aren't about to converse
    if (res.blockerId && rt.path.length > 0 && (rt.blockedTicks ?? 0) === 0) {
      const goal = rt.path[rt.path.length - 1];
      const rerouted = findPath(
        this.map,
        { x: rt.x, y: rt.y },
        goal,
        this.getOccupiedTileSet(rt.id),
      );
      if (rerouted.length > 0) {
        rt.path = rerouted;
      }
    }

    if (res.progressed) {
      rt.blockedTicks = 0;
      return !res.reachedEnd;
    }

    rt.blockedTicks = (rt.blockedTicks ?? 0) + 1;

    // Meeting another villager up close sparks a natural conversation when autoConverse is on
    if (
      res.blockerId &&
      res.blockerId !== this.player.id &&
      this.modelSettings.autoConverse &&
      !rt.activeConversationId
    ) {
      const otherRt = this.runtimes.get(res.blockerId);
      const now = Date.now();
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
        this.startAutonomousConversation(rt.id, otherRt.id);
        return false;
      }
    }

    // Reroute cleanly around persistent obstacles instead of staying frozen
    if (rt.blockedTicks === 6 || rt.blockedTicks === 12) {
      const goal = rt.path[rt.path.length - 1];
      if (goal) {
        const distToGoal = Math.hypot(goal.x - rt.x, goal.y - rt.y);
        if (distToGoal < 1.35) {
          rt.path = [];
          rt.blockedTicks = 0;
          return false;
        }
        const rerouted = findPath(
          this.map,
          { x: rt.x, y: rt.y },
          goal,
          this.getOccupiedTileSet(rt.id),
        );
        if (rerouted.length > 0) {
          rt.path = rerouted;
          return true;
        }
      }
    }

    if (rt.blockedTicks > 18) {
      rt.path = [];
      rt.blockedTicks = 0;
      // Shorten wait before next autonomous move so villager immediately picks a clear path
      rt.lastMoveAt = Date.now() - 2200;
      return false;
    }
    return true;
  }

  private runAutonomousDecisions() {
    const now = Date.now();
    const runtimesList = [...this.runtimes.values()];

    // 1. Pair nearby villagers (idle OR walking) so passersby stop and interact visibly
    if (this.modelSettings.autoConverse) {
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
        if (now - a.lastThinkAt < 6500) continue;

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
          if (now - b.lastThinkAt < 6500) continue;

          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist <= 3.8 && Math.random() < 0.85) {
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
      if (now - rt.lastMoveAt < 2800 + Math.random() * 3000) continue;

      const cfg = this.configs.get(rt.id);
      if (!cfg) continue;

      this.planningVillagers.add(rt.id);
      void this.planNextVillagerAction(cfg, rt).finally(() => {
        this.planningVillagers.delete(rt.id);
      });
    }
  }

  private async planNextVillagerAction(cfg: VillagerConfig, rt: VillagerRuntime) {
    const now = Date.now();
    const others = [...this.configs.values()].filter((v) => v.id !== cfg.id);
    const landmarks = this.map.spawnPoints.map((s) => s.label);

    const decision = await brainRouter.decideVillagerNextAction({
      villager: cfg,
      runtime: rt,
      otherNames: others.map((v) => v.name),
      landmarkNames: landmarks,
      settings: this.modelSettings,
    });

    if (rt.activeConversationId || rt.state !== 'idle') {
      rt.lastMoveAt = Date.now();
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
      const lm = this.map.spawnPoints.find(
        (s) => s.label.toLowerCase() === decision.targetName!.toLowerCase(),
      );
      if (lm) {
        safeGoal = this.findAdjacentStandTile(lm.x, lm.y, rt.id);
      }
    }

    if (
      !safeGoal ||
      (safeGoal.x === Math.round(rt.x) && safeGoal.y === Math.round(rt.y))
    ) {
      const tx = Math.round(rt.x + (Math.random() > 0.5 ? 1 : -1) * (3 + Math.random() * 5));
      const ty = Math.round(rt.y + (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 5));
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
        Math.round(rt.x + (Math.random() * 12 - 6)),
        Math.round(rt.y + (Math.random() * 10 - 5)),
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
    const now = Date.now();
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
          ? spawnPoints[(i * 2 + Math.floor(Math.random() * spawnPoints.length)) % spawnPoints.length]
          : undefined;
      const offsetX = Math.round(Math.random() * 10 - 5);
      const offsetY = Math.round(Math.random() * 8 - 4);
      const rawGoalX = sp ? sp.x + offsetX : Math.round(rt.x + (Math.random() * 14 - 7));
      const rawGoalY = sp ? sp.y + offsetY : Math.round(rt.y + (Math.random() * 12 - 6));
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
        rt.currentIntention = sp ? `Heading out near ${sp.label}` : 'Exploring Selo lanes';
        rt.activityLabel = rt.currentIntention;
      }
    }
    this.notify(true);
  }

  private getNearestLandmarkName(x: number, y: number): string {
    if (this.map.spawnPoints.length === 0) return 'Village Square';
    let best = this.map.spawnPoints[0];
    let bestDist = Infinity;
    for (const sp of this.map.spawnPoints) {
      const d = Math.hypot(sp.x - x, sp.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = sp;
      }
    }
    return best.label;
  }

  private async emitNarrationTurn(
    conv: Conversation,
    text: string,
    speakAudio: boolean,
    spatialResolver?: () => SpatialMix,
  ): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    conv.messages.push({
      id: `msg-nar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderId: 'narrator',
      senderName: this.modelSettings.narratorName.trim() || 'Scribe',
      text: clean,
      timestamp: Date.now(),
      kind: 'narration',
      source: 'story-sim',
    });
    conv.updatedAt = Date.now();
    this.notify(true);

    if (speakAudio && this.modelSettings.narratorEnabled) {
      const mix = spatialResolver?.();
      if (!spatialResolver || mix?.inRange) {
        await brainRouter.speakNarration(clean, this.modelSettings, spatialResolver);
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

    const convId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (this.busyConversations.has(convId)) return undefined;
    this.busyConversations.add(convId);

    const conv: Conversation = {
      id: convId,
      participantIds: [idA, idB],
      messages: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
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

    const midpointResolver = () =>
      computeSpatialMix(
        (rtA.x + rtB.x) / 2,
        (rtA.y + rtB.y) / 2,
        this.player.x,
        this.player.y,
        this.modelSettings.proximityRadiusTiles,
      );

    try {
      const eavesdropEnabled = this.modelSettings.proximityRadiusTiles > 0;
      const landmarkName = this.getNearestLandmarkName((rtA.x + rtB.x) / 2, (rtA.y + rtB.y) / 2);
      if (this.modelSettings.narratorEnabled && this.modelSettings.narrateEvents) {
        const introBeat = await brainRouter.generateSceneBeat({
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
        await this.emitNarrationTurn(
          conv,
          introBeat,
          eavesdropEnabled,
          midpointResolver,
        );
      }

      const turns: Array<[VillagerConfig, VillagerRuntime, VillagerConfig]> = [
        [cfgA, rtA, cfgB],
        [cfgB, rtB, cfgA],
        [cfgA, rtA, cfgB],
      ];

      for (const [speakerCfg, speakerRt, partnerCfg] of turns) {
        if (!this.runtimes.has(speakerCfg.id) || !this.runtimes.has(partnerCfg.id)) break;
        speakerRt.state = 'thinking';
        this.notify(true);

        const resolver = () =>
          computeSpatialMix(
            speakerRt.x,
            speakerRt.y,
            this.player.x,
            this.player.y,
            this.modelSettings.proximityRadiusTiles,
          );

        const res = await brainRouter.generateVillagerReply({
          villager: speakerCfg,
          runtime: speakerRt,
          partnerName: partnerCfg.name,
          history: conv.messages,
          settings: this.modelSettings,
          speakSpatialResolver: eavesdropEnabled ? resolver : undefined,
        });

        const parsed = parseDialogueAndNarration(res.text, speakerCfg.name);

        if (parsed.narration.length > 0 && this.modelSettings.narratorEnabled) {
          for (const beat of parsed.narration) {
            const actionText = `${speakerCfg.name} ${beat.charAt(0).toLowerCase()}${beat.slice(1)}`;
            await this.emitNarrationTurn(
              conv,
              actionText,
              eavesdropEnabled && !res.audioHandled,
              resolver,
            );
          }
        }

        const spokenLine = parsed.spoken || parsed.display;
        speakerRt.lastLatencyMs = res.durationMs;
        speakerRt.state = 'speaking';
        speakerRt.currentBubble = {
          text: spokenLine,
          expiresAt: Date.now() + 5500,
        };
        conv.messages.push({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          senderId: speakerCfg.id,
          senderName: speakerCfg.name,
          text: spokenLine,
          timestamp: Date.now(),
          kind: 'speech',
          source: res.source,
        });
        conv.updatedAt = Date.now();
        this.notify(true);

        if (eavesdropEnabled && !res.audioHandled && parsed.spoken) {
          const mix = resolver();
          if (mix.inRange) {
            await brainRouter.speakLine(parsed.spoken, speakerCfg, this.modelSettings, resolver);
          }
        }
        speakerRt.state = 'conversing';

        await new Promise((r) => setTimeout(r, 400));
      }

      // Reflect short conversation into memory for both villagers
      const transcript = conv.messages
        .filter((m) => m.kind !== 'narration')
        .map((m) => `${m.senderName}: ${m.text}`)
        .join('\n');
      const memA = await brainRouter.reflectMemory({
        villager: cfgA,
        transcript,
        settings: this.modelSettings,
      });
      rtA.memories.push({
        id: `mem-${Date.now()}-a`,
        timestamp: Date.now(),
        importance: 6,
        kind: 'conversation',
        summary: memA,
      });
      this.appendWorldEvent(rtA, `Talked with ${cfgB.name}: ${memA}`);
      const firstSpoken = conv.messages.find((m) => m.kind !== 'narration');
      const bSummary = `Talked with ${cfgA.name}: ${firstSpoken?.text.slice(0, 64) ?? ''}`;
      rtB.memories.push({
        id: `mem-${Date.now()}-b`,
        timestamp: Date.now(),
        importance: 6,
        kind: 'conversation',
        summary: bSummary,
      });
      this.appendWorldEvent(rtB, bSummary);

      if (this.modelSettings.narratorEnabled && this.modelSettings.narrateEvents) {
        const closing = await brainRouter.generateSceneBeat({
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
        await this.emitNarrationTurn(
          conv,
          closing,
          eavesdropEnabled,
          midpointResolver,
        );
      }
      return conv;
    } catch {
      // Ignore transient errors in background chatter
    } finally {
      conv.active = false;
      this.busyConversations.delete(convId);
      for (const [rt, cfg] of [
        [rtA, cfgA],
        [rtB, cfgB],
      ] as const) {
        if (rt.activeConversationId === convId) {
          rt.activeConversationId = undefined;
          rt.state = 'idle';
          rt.activityLabel = rt.currentIntention || cfg.plan;
          rt.lastThinkAt = Date.now();
          rt.lastMoveAt = Date.now();
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
      id: `conv-human-${villagerId}-${Date.now()}`,
      participantIds: [this.player.id, villagerId],
      messages: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
      active: true,
    };
    this.conversations = [conv, ...this.conversations].slice(0, 50);
    return conv;
  }

  private buildSceneContext(): string {
    const lines: string[] = [];
    for (const cfg of this.configs.values()) {
      const rt = this.runtimes.get(cfg.id);
      if (!rt) continue;
      const near = this.getNearestLandmarkName(rt.x, rt.y);
      const lastEvent = rt.worldFeed?.slice(-1)[0];
      lines.push(
        `- ${cfg.name} near ${near} (${rt.state}): ${rt.currentIntention || rt.activityLabel}${lastEvent ? ` | latest: ${lastEvent}` : ''}`,
      );
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
    rt.memories.push({
      id: `mem-dir-${Date.now()}-${slotIndex}`,
      timestamp: Date.now(),
      importance: 6,
      kind: 'observation',
      summary: `${this.player.name} instructed: "${userText.slice(0, 80)}"`,
    });
    const lower = userText.toLowerCase();

    // Let natural language "@Character / @all go talk to Taras / visit windmill / scatter" steer motivation + movement
    const directedMotion = /\b(go|head|walk|meet|find|talk|visit|check|gather|move|wander|scatter|roam|explore|disperse|come|patrol|spread)\b/i.test(
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

    const landmark = this.map.spawnPoints.find((sp) => {
      const words = sp.label.toLowerCase().split(/\s+/);
      return lower.includes(sp.label.toLowerCase()) || words.some((w) => w.length > 3 && lower.includes(w));
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
        ? this.map.spawnPoints[(slotIndex + Math.floor(Math.random() * this.map.spawnPoints.length)) % this.map.spawnPoints.length]
        : undefined;
    const goal = findNearestWalkableTile(
      this.map,
      Math.round((sp?.x ?? rt.x) + (slotIndex % 2 === 0 ? 3 : -3)),
      Math.round((sp?.y ?? rt.y) + (slotIndex % 3 === 0 ? 2 : -2)),
    );
    const path = findBestPath(goal);
    rt.currentIntention = sp ? `Roaming paths near ${sp.label}` : 'Moving across Selo';
    rt.activityLabel = rt.currentIntention;
    if (path.length > 0) {
      rt.path = path;
      rt.state = 'walking';
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

    const streamingMsg: ChatMessage = {
      id: `msg-v-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      senderId: cfg.id,
      senderName: cfg.name,
      text: '',
      timestamp: Date.now(),
      kind: 'speech',
      source: 'story-sim',
    };
    conv.messages.push(streamingMsg);

    try {
      const resolver = () => {
        const mix = computeSpatialMix(
          rt.x,
          rt.y,
          this.player.x,
          this.player.y,
          Math.max(9, this.modelSettings.proximityRadiusTiles),
        );
        return {
          ...mix,
          gain: Math.max(0.35, mix.gain),
          inRange: true,
        };
      };

      const res = await brainRouter.generateVillagerReply({
        villager: cfg,
        runtime: rt,
        partnerName: this.player.name,
        history: conv.messages.slice(0, -1),
        settings: this.modelSettings,
        speakSpatialResolver: speakReply ? resolver : undefined,
        onChunk: (chunk) => {
          streamingMsg.text += chunk;
          rt.currentBubble = { text: streamingMsg.text, expiresAt: Date.now() + 8000 };
          this.notify();
        },
      });

      const parsed = parseDialogueAndNarration(res.text, cfg.name);
      if (parsed.narration.length > 0 && this.modelSettings.narratorEnabled) {
        for (const beat of parsed.narration) {
          await this.emitNarrationTurn(
            conv,
            `${cfg.name} ${beat.charAt(0).toLowerCase()}${beat.slice(1)}`,
            speakReply && !res.audioHandled,
            resolver,
          );
        }
      }

      const finalSpoken = parsed.spoken || parsed.display;
      streamingMsg.text = finalSpoken;
      streamingMsg.kind = 'speech';
      streamingMsg.source = res.source;
      rt.lastLatencyMs = res.durationMs;
      rt.currentBubble = { text: finalSpoken, expiresAt: Date.now() + 7000 };
      const summary = `${this.player.name} said: "${userText.slice(0, 50)}". I replied: "${finalSpoken.slice(0, 55)}"`;
      rt.memories.push({
        id: `mem-u-${Date.now()}`,
        timestamp: Date.now(),
        importance: 7,
        kind: 'conversation',
        summary,
      });
      this.appendWorldEvent(rt, `Replied to ${this.player.name}: "${finalSpoken.slice(0, 64)}"`);
      rt.state = speakReply ? 'speaking' : 'idle';
      rt.activityLabel = rt.currentIntention || cfg.plan;
      this.notify(true);

      if (speakReply && !res.audioHandled && finalSpoken) {
        await brainRouter.speakLine(finalSpoken, cfg, this.modelSettings, resolver);
      }
    } finally {
      rt.state = rt.path.length > 0 ? 'walking' : 'idle';
      rt.lastThinkAt = Date.now();
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
      id: `msg-nar-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      senderId: 'narrator',
      senderName: narratorName,
      text: '',
      timestamp: Date.now(),
      kind: 'narration',
      source: 'story-sim',
    };
    conv.messages.push(streamingMsg);
    this.notify(true);

    const res = await brainRouter.generateNarratorReply({
      prompt: userText,
      sceneContext: this.buildSceneContext(),
      history: conv.messages.slice(0, -1),
      settings: this.modelSettings,
      onChunk: (chunk) => {
        streamingMsg.text += chunk;
        this.notify();
      },
    });

    streamingMsg.text = res.text;
    streamingMsg.source = res.source;
    conv.updatedAt = Date.now();
    this.notify(true);

    if (speakReply && this.modelSettings.narratorEnabled && res.text.trim()) {
      await brainRouter.speakNarration(res.text, this.modelSettings);
    }
  }

  async sendUserTextToVillager(villagerId: string, text: string, speakReply = true): Promise<void> {
    const cfg = this.configs.get(villagerId);
    const rt = this.runtimes.get(villagerId);
    if (!cfg || !rt) return;

    const conv = this.getOrCreateHumanConversation(villagerId);
    conv.messages.push({
      id: `msg-u-${Date.now()}`,
      senderId: this.player.id,
      senderName: this.player.name,
      text,
      timestamp: Date.now(),
      source: 'human-text',
    });
    conv.updatedAt = Date.now();
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

    if (targets.length === 0) {
      if (activeTargetId === 'narrator') {
        const conv = this.getOrCreateHumanConversation('narrator');
        conv.messages.push({
          id: `msg-u-${Date.now()}`,
          senderId: this.player.id,
          senderName: this.player.name,
          text,
          timestamp: Date.now(),
          source: 'human-text',
        });
        conv.updatedAt = Date.now();
        await this.executeNarratorReplyTurn(conv, text, speakReply);
        return { focusedTargetId: 'narrator' };
      }
      if (activeTargetId) {
        await this.sendUserTextToVillager(activeTargetId, text, speakReply);
      }
      return { focusedTargetId: activeTargetId };
    }

    if (targets.length === 1 && targets[0].kind === 'villager') {
      await this.sendUserTextToVillager(targets[0].id, text, speakReply);
      return { focusedTargetId: targets[0].id };
    }

    const hostId =
      activeTargetId && (activeTargetId === 'narrator' || this.configs.has(activeTargetId))
        ? activeTargetId
        : targets[0].id;
    const conv = this.getOrCreateHumanConversation(hostId);
    conv.messages.push({
      id: `msg-u-${Date.now()}`,
      senderId: this.player.id,
      senderName: this.player.name,
      text,
      timestamp: Date.now(),
      source: 'human-text',
    });
    conv.updatedAt = Date.now();
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
      id: `msg-uv-${Date.now()}`,
      senderId: this.player.id,
      senderName: this.player.name,
      text: 'Transcribing voice…',
      timestamp: Date.now(),
      source: 'human-voice',
      hasAudio: true,
    };
    const replyMsg: ChatMessage = {
      id: `msg-vo-${Date.now()}`,
      senderId: cfg.id,
      senderName: cfg.name,
      text: '',
      timestamp: Date.now(),
      source: 'lfm3-omni',
      hasAudio: true,
    };
    conv.messages.push(userMsg, replyMsg);
    this.notify(true);

    try {
      const res = await brainRouter.converseWithVoice({
        villager: cfg,
        runtime: rt,
        audioBuffer,
        settings: this.modelSettings,
        onTextChunk: (chunk) => {
          replyMsg.text += chunk;
          rt.state = 'speaking';
          rt.currentBubble = { text: replyMsg.text, expiresAt: Date.now() + 8000 };
          this.notify();
        },
      });
      userMsg.text = res.userTranscript;
      replyMsg.text = res.replyText;
      rt.lastLatencyMs = res.durationMs;
      rt.currentBubble = { text: res.replyText, expiresAt: Date.now() + 7500 };
      rt.memories.push({
        id: `mem-ov-${Date.now()}`,
        timestamp: Date.now(),
        importance: 8,
        kind: 'conversation',
        summary: `Voice chat with ${this.player.name}: "${res.userTranscript.slice(0, 50)}"`,
      });
    } finally {
      rt.state = 'idle';
      rt.activityLabel = cfg.plan;
      rt.lastThinkAt = Date.now();
      this.notify(true);
    }
  }
}
