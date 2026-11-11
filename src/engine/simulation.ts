import { computeSpatialMix, type SpatialMix } from '../ai/audioPipeline';
import { brainRouter, parseDialogueAndNarration } from '../ai/brainRouter';
import { computeFacing, findNearestWalkableTile, findPath, isTileWalkable } from './pathfinding';
import type {
  ChatMessage,
  Conversation,
  Direction,
  ModelSettings,
  VillageMap,
  VillagerConfig,
  VillagerRuntime,
} from './types';

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

    for (const v of villagers) {
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
          memories: [
            {
              id: `mem-init-${v.id}`,
              timestamp: Date.now(),
              importance: 5,
              kind: 'observation',
              summary: v.plan,
            },
          ],
          lastThinkAt: Date.now() - Math.random() * 4000,
          lastMoveAt: Date.now(),
          animFrame: 0,
        });
      }
    }
    this.notify(true);
  }

  movePlayerTo(tileX: number, tileY: number) {
    const target = findNearestWalkableTile(this.map, tileX, tileY);
    const path = findPath(this.map, { x: this.player.x, y: this.player.y }, target);
    this.player.path = path;
  }

  nudgePlayer(dx: number, dy: number, dt: number) {
    if (dx === 0 && dy === 0) return;
    this.player.path = [];
    this.player.isMoving = true;
    this.player.lastNudgeAt = performance.now();
    const nx = this.player.x + dx * this.player.speed * dt;
    const ny = this.player.y + dy * this.player.speed * dt;
    if (isTileWalkable(this.map, Math.round(nx), Math.round(this.player.y))) {
      this.player.x = nx;
    }
    if (isTileWalkable(this.map, Math.round(this.player.x), Math.round(ny))) {
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

      if (rt.path.length > 0 && rt.state !== 'conversing' && rt.state !== 'thinking') {
        rt.state = 'walking';
        const moved = this.advanceVillagerPath(rt, cfg.speed, dt);
        if (!moved) {
          rt.state = 'idle';
          rt.lastMoveAt = now;
        }
      } else if (rt.state === 'walking') {
        rt.state = 'idle';
      }
    }

    this.aiAccumulator += dt;
    if (this.aiAccumulator >= 1.2) {
      this.aiAccumulator = 0;
      this.runAutonomousDecisions();
      this.notify();
    }
  }

  private advanceEntityPath(entity: { x: number; y: number; path: Array<{ x: number; y: number }>; facing: Direction; animFrame: number; speed: number }, dt: number) {
    if (entity.path.length === 0) return;
    const next = entity.path[0];
    const dx = next.x - entity.x;
    const dy = next.y - entity.y;
    const dist = Math.hypot(dx, dy);
    const step = entity.speed * dt;
    entity.facing = computeFacing(entity, next, entity.facing);
    entity.animFrame += dt * 7;

    if (dist <= step) {
      entity.x = next.x;
      entity.y = next.y;
      entity.path.shift();
    } else {
      entity.x += (dx / dist) * step;
      entity.y += (dy / dist) * step;
    }
  }

  private advanceVillagerPath(rt: VillagerRuntime, speed: number, dt: number): boolean {
    if (rt.path.length === 0) return false;
    const next = rt.path[0];
    const dx = next.x - rt.x;
    const dy = next.y - rt.y;
    const dist = Math.hypot(dx, dy);
    const step = speed * dt;
    rt.facing = computeFacing(rt, next, rt.facing);
    rt.animFrame += dt * 5;

    if (dist <= step) {
      rt.x = next.x;
      rt.y = next.y;
      rt.path.shift();
      return rt.path.length > 0;
    }
    rt.x += (dx / dist) * step;
    rt.y += (dy / dist) * step;
    return true;
  }

  private runAutonomousDecisions() {
    const now = Date.now();
    const runtimesList = [...this.runtimes.values()];

    // 1. Pair nearby idle villagers for spontaneous autonomous village conversations
    if (this.modelSettings.autoConverse) {
      for (let i = 0; i < runtimesList.length; i++) {
        const a = runtimesList[i];
        if (a.state !== 'idle' || a.activeConversationId) continue;
        if (now - a.lastThinkAt < 9000) continue;

        for (let j = i + 1; j < runtimesList.length; j++) {
          const b = runtimesList[j];
          if (b.state !== 'idle' || b.activeConversationId) continue;
          if (now - b.lastThinkAt < 9000) continue;

          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist <= 3.6 && Math.random() < 0.45) {
            this.startAutonomousConversation(a.id, b.id);
            break;
          }
        }
      }
    }

    // 2. Give idle villagers a new stroll destination across landmarks or home tiles
    for (const rt of runtimesList) {
      if (rt.state !== 'idle' || rt.activeConversationId || rt.path.length > 0) continue;
      if (now - rt.lastMoveAt < 3500 + Math.random() * 4500) continue;

      const blocked = new Set<string>();
      for (const other of runtimesList) {
        if (other.id !== rt.id) blocked.add(`${Math.round(other.x)},${Math.round(other.y)}`);
      }

      const useLandmark = this.map.spawnPoints.length > 0 && Math.random() < 0.35;
      let targetX = Math.round(rt.x + (Math.random() * 12 - 6));
      let targetY = Math.round(rt.y + (Math.random() * 10 - 5));
      if (useLandmark) {
        const lm = this.map.spawnPoints[Math.floor(Math.random() * this.map.spawnPoints.length)];
        targetX = lm.x + Math.round(Math.random() * 4 - 2);
        targetY = lm.y + Math.round(Math.random() * 4 - 2);
      }

      const safeGoal = findNearestWalkableTile(this.map, targetX, targetY);
      const path = findPath(this.map, { x: rt.x, y: rt.y }, safeGoal, blocked);
      if (path.length > 0) {
        rt.path = path;
        rt.state = 'walking';
        rt.lastMoveAt = now;
      } else {
        rt.lastMoveAt = now;
      }
    }
  }

  private buildSceneIntro(cfgA: VillagerConfig, cfgB: VillagerConfig): string {
    const style = this.modelSettings.narratorStyle;
    if (style === 'chronicler') {
      return `${cfgA.name} and ${cfgB.name} pause nearby in Selo for a word.`;
    }
    if (style === 'storybook') {
      return `Along the village lane, ${cfgA.name} crosses paths with ${cfgB.name}.`;
    }
    return `${cfgA.name}, the ${cfgA.role.toLowerCase()}, meets ${cfgB.name}, the ${cfgB.role.toLowerCase()}, and they step close to speak.`;
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
      if (this.modelSettings.narratorEnabled && this.modelSettings.narrateEvents) {
        await this.emitNarrationTurn(
          conv,
          this.buildSceneIntro(cfgA, cfgB),
          this.modelSettings.proximityAudioEnabled,
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
          speakSpatialResolver: this.modelSettings.proximityAudioEnabled ? resolver : undefined,
        });

        const parsed = parseDialogueAndNarration(res.text, speakerCfg.name);

        if (parsed.narration.length > 0 && this.modelSettings.narratorEnabled) {
          for (const beat of parsed.narration) {
            const actionText = `${speakerCfg.name} ${beat.charAt(0).toLowerCase()}${beat.slice(1)}`;
            await this.emitNarrationTurn(
              conv,
              actionText,
              this.modelSettings.proximityAudioEnabled && !res.audioHandled,
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

        if (this.modelSettings.proximityAudioEnabled && !res.audioHandled && parsed.spoken) {
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
      const firstSpoken = conv.messages.find((m) => m.kind !== 'narration');
      rtB.memories.push({
        id: `mem-${Date.now()}-b`,
        timestamp: Date.now(),
        importance: 6,
        kind: 'conversation',
        summary: `Talked with ${cfgA.name}: ${firstSpoken?.text.slice(0, 64) ?? ''}`,
      });

      if (this.modelSettings.narratorEnabled && this.modelSettings.narrateEvents) {
        const closing = `${cfgA.name} and ${cfgB.name} part ways, carrying their thoughts back into Selo.`;
        await this.emitNarrationTurn(
          conv,
          closing,
          this.modelSettings.proximityAudioEnabled,
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
          rt.activityLabel = cfg.plan;
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

    rt.path = [];
    rt.facing = computeFacing(rt, this.player, rt.facing);
    rt.state = 'thinking';
    rt.activityLabel = `Listening to ${this.player.name}`;
    this.notify(true);

    const streamingMsg: ChatMessage = {
      id: `msg-v-${Date.now()}`,
      senderId: cfg.id,
      senderName: cfg.name,
      text: '',
      timestamp: Date.now(),
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
          this.modelSettings.proximityRadiusTiles,
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
      rt.memories.push({
        id: `mem-u-${Date.now()}`,
        timestamp: Date.now(),
        importance: 7,
        kind: 'conversation',
        summary: `${this.player.name} said: "${text.slice(0, 50)}". I replied: "${finalSpoken.slice(0, 55)}"`,
      });
      rt.state = speakReply ? 'speaking' : 'idle';
      rt.activityLabel = cfg.plan;
      this.notify(true);

      if (speakReply && !res.audioHandled && finalSpoken) {
        await brainRouter.speakLine(finalSpoken, cfg, this.modelSettings, resolver);
      }
    } finally {
      rt.state = 'idle';
      rt.lastThinkAt = Date.now();
      this.notify(true);
    }
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
