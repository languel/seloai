import { createBrowserSimulation } from '../../app/browserSimulation';
import { describe, expect, it } from 'vitest';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { DEFAULT_PLAYER_APPEARANCE } from '../../utils/aestheticThemes';
import { createSeededRng, randomizeAppearance } from '../characterGenerator';
import {
  computeHeapSlopeMbPerMin,
  evaluateMemoryHealth,
  perfMemoryTracker,
  type PerfMemorySamplePoint,
} from '../perfMemoryTracker';
import { clearPlayerSpriteCache, generateProceduralPlayerCustomSprite, getPlayerSpriteCacheCount } from '../playerSpriteGenerator';
import { getImageCacheStats, pruneImageCache } from '../renderer';
import { clearSpriteSheetCache, generateSpriteSheetDataUrl, getSpriteSheetCacheCount } from '../spriteGenerator';

describe('performance & memory leak protections', () => {
  it('tracks frame ring metrics, heap leak slope, health severity, and JSON diagnostics', () => {
    perfMemoryTracker.resetPeaks();
    perfMemoryTracker.registerProvider({
      getEngines: () => [
        {
          id: 'lfm3-1.7b',
          label: 'LFM3-1.7B',
          backend: 'worker-onnx',
          status: 'ready',
          modelId: 'onnx/LFM3',
          liveBytes: 900_000_000,
          peakBytes: 950_000_000,
        },
        {
          id: 'lfm3-omni',
          label: 'LFM3-Omni',
          backend: 'webgpu',
          status: 'ready',
          modelId: 'onnx/Omni',
          liveBytes: 1_900_000_000,
          peakBytes: 2_100_000_000,
        },
      ],
    });

    try {
      for (let i = 0; i < 40; i++) {
        const dt = i % 10 === 0 ? 64 : 16.5;
        perfMemoryTracker.recordFrameSample(dt, 1.8, 3.2);
      }
      const snap = perfMemoryTracker.captureSnapshot(false);
      expect(snap.fps).toBeGreaterThan(10);
      expect(snap.frameDtP95Ms).toBeGreaterThanOrEqual(snap.frameDtAvgMs);
      expect(snap.frameDtMaxMs).toBe(64);
      expect(snap.longFramesWindow).toBe(4);
      expect(snap.totalLongFrames).toBeGreaterThanOrEqual(4);
      expect(snap.simStepAvgMs).toBeCloseTo(1.8, 1);
      expect(snap.renderAvgMs).toBeCloseTo(3.2, 1);
      expect(snap.health.status).toBe('pressure');
      expect(snap.health.reasons.some((r) => r.includes('LLM engines loaded simultaneously'))).toBe(true);

      const baseT = 1_700_000_000_000;
      const flatHistory: PerfMemorySamplePoint[] = Array.from({ length: 12 }, (_, idx) => ({
        timestamp: baseT + idx * 10_000,
        fps: 60,
        frameDtAvgMs: 16.6,
        simStepAvgMs: 1.1,
        renderAvgMs: 2.5,
        jsHeapUsedBytes: (120 + (idx % 3 === 0 ? 1 : 0)) * 1024 * 1024,
        gpuLiveBytes: 0,
        totalMessages: 20,
        timelineFrames: 30,
      }));
      const flatSlope = computeHeapSlopeMbPerMin(flatHistory);
      expect(Math.abs(flatSlope)).toBeLessThan(2);

      const healthy = evaluateMemoryHealth(
        {
          jsHeapUsedBytes: 120 * 1024 * 1024,
          jsHeapLimitBytes: 2048 * 1024 * 1024,
          jsHeapSlopeMbPerMin: flatSlope,
          gpuLiveBytes: 0,
          engines: [],
          simStats: {
            conversationCount: 2,
            activeConversationCount: 1,
            totalMessages: 20,
            villagerCount: 6,
            totalMemories: 12,
            totalWorldFeedItems: 18,
            timelineFrames: 30,
            cachedConvSnapshots: 2,
          },
          caches: {
            imageCacheCount: 4,
            imageCacheDataUrlCount: 2,
            spriteSheetCacheCount: 6,
            playerSpriteCacheCount: 1,
            telemetryEvents: 10,
            pendingWorkerRequests: 0,
            audioActiveSources: 0,
            audioContextState: 'running',
          },
          frameDtP95Ms: 17,
        },
        flatHistory,
      );
      expect(healthy.status).toBe('healthy');
      expect(healthy.reasons).toEqual([]);

      const leakHistory: PerfMemorySamplePoint[] = Array.from({ length: 15 }, (_, idx) => ({
        timestamp: baseT + idx * 10_000,
        fps: 55,
        frameDtAvgMs: 18,
        simStepAvgMs: 1.5,
        renderAvgMs: 3.1,
        jsHeapUsedBytes: (100 + idx * 4) * 1024 * 1024,
        gpuLiveBytes: 0,
        totalMessages: 50,
        timelineFrames: 60,
      }));
      const leakSlope = computeHeapSlopeMbPerMin(leakHistory);
      expect(leakSlope).toBeCloseTo(24, 1);

      const leakHealth = evaluateMemoryHealth(
        {
          ...healthy,
          jsHeapUsedBytes: 156 * 1024 * 1024,
          jsHeapLimitBytes: 2048 * 1024 * 1024,
          jsHeapSlopeMbPerMin: leakSlope,
          gpuLiveBytes: 0,
          engines: [],
          simStats: flatHistory[0] ? {
            conversationCount: 2,
            activeConversationCount: 1,
            totalMessages: 50,
            villagerCount: 6,
            totalMemories: 12,
            totalWorldFeedItems: 18,
            timelineFrames: 60,
            cachedConvSnapshots: 2,
          } : snap.simStats,
          caches: snap.caches,
          frameDtP95Ms: 18,
        },
        leakHistory,
      );
      expect(leakHealth.status).toBe('leak-risk');
      expect(leakHealth.reasons.some((r) => r.includes('Sustained JS heap growth'))).toBe(true);

      const parsed = JSON.parse(perfMemoryTracker.exportDiagnosticsJson());
      expect(typeof parsed.exportedAt).toBe('string');
      expect(parsed.snapshot.health.status).toBe('pressure');
    } finally {
      perfMemoryTracker.registerProvider({ getEngines: () => [] });
      perfMemoryTracker.resetPeaks();
    }
  });

  it('bounds VillageSimulation memories, messages, timeline keyframes, caches, and structural clones', async () => {
    const map = createDefaultMap();
    const sim = createBrowserSimulation(
      map,
      DEFAULT_VILLAGERS,
      [],
      { ...DEFAULT_MODEL_SETTINGS, inferenceMode: 'story-sim', enableWebSpeechFallback: false },
    );

    const target = DEFAULT_VILLAGERS[0];
    const rt = sim.runtimes.get(target.id)!;
    // Inject > 64 memories mixing critical importance >= 8 and routine memories
    for (let i = 0; i < 90; i++) {
      (sim as any).pushVillagerMemory(rt, {
        id: `m-${i}`,
        timestamp: 1000 + i,
        importance: i < 5 ? 9 : 3,
        kind: 'observation',
        summary: `Event #${i}`,
      });
    }
    expect(rt.memories.length).toBeLessThanOrEqual(64);
    expect(rt.memories.some((m) => m.id === 'm-0')).toBe(true); // preserved high-importance memory
    expect(rt.memories.some((m) => m.id === 'm-89')).toBe(true); // preserved newest memory

    await sim.sendUserTextToVillager(target.id, 'First check-in', false);
    const conv = sim.conversations.find((c) => c.participantIds.includes(target.id))!;
    for (let i = 0; i < 210; i++) {
      (sim as any).pushConversationMessage(conv, {
        id: `bulk-${i}`,
        senderId: target.id,
        senderName: target.name,
        text: `Line ${i}`,
        timestamp: 2000 + i,
        source: 'story-sim',
      });
    }
    expect(conv.messages.length).toBeLessThanOrEqual(160);
    expect(conv.messages[conv.messages.length - 1].id).toBe('bulk-209');

    // Step frames & verify timeline cap + unchanged conversation reference reuse across keyframes
    for (let i = 0; i < 500; i++) {
      sim.stepFrame(0.05);
      (sim as any).recordTimelineKeyframe(Date.now());
    }
    const statsBeforeTrim = sim.getMemoryStats();
    expect(statsBeforeTrim.timelineFrames).toBeLessThanOrEqual(450);
    const tl = (sim as any).timeline as Array<{ conversations: unknown[] }>;
    expect(tl.length).toBeLessThanOrEqual(450);
    expect(tl.length).toBeGreaterThan(2);
    expect(tl[tl.length - 1].conversations[0]).toBe(tl[tl.length - 2].conversations[0]);

    // Manual trimMemoryUsage actively shrinks buffers on demand while preserving safety floors
    sim.trimMemoryUsage({ maxTimelineFrames: 60, maxMessagesPerConv: 24, maxMemoriesPerVillager: 20 });
    const statsAfterTrim = sim.getMemoryStats();
    expect(statsAfterTrim.timelineFrames).toBe(60);
    expect(conv.messages.length).toBe(24);
    expect(rt.memories.length).toBe(20);

    sim.trimMemoryUsage({ maxTimelineFrames: 10, maxMessagesPerConv: 5 });
    expect(sim.getMemoryStats().timelineFrames).toBe(30);
    expect(conv.messages.length).toBe(20);

    // syncVillagers cleans removed villagers from internal per-villager maps
    const removedId = DEFAULT_VILLAGERS[DEFAULT_VILLAGERS.length - 1].id;
    (sim as any).lastMoveSimMs.set(removedId, 123);
    (sim as any).lastThinkSimMs.set(removedId, 456);
    (sim as any).lastMemCache.set(removedId, { len: 1, sig: 'x', items: [] });
    (sim as any).lastFeedCache.set(removedId, { len: 1, sig: 'y', items: [] });

    sim.syncVillagers(DEFAULT_VILLAGERS.slice(0, DEFAULT_VILLAGERS.length - 1));
    expect(sim.getMemoryStats().villagerCount).toBe(DEFAULT_VILLAGERS.length - 1);
    expect((sim as any).lastMoveSimMs.has(removedId)).toBe(false);
    expect((sim as any).lastThinkSimMs.has(removedId)).toBe(false);
    expect((sim as any).lastMemCache.has(removedId)).toBe(false);
    expect((sim as any).lastFeedCache.has(removedId)).toBe(false);
  });

  it('bounds sprite and image caches via LRU eviction and explicit cleanup helpers', () => {
    clearPlayerSpriteCache();
    clearSpriteSheetCache();
    try {
      for (let i = 0; i < 32; i++) {
        const hex = `#${(0x102030 + i * 0x050301).toString(16).padStart(6, '0').slice(-6)}`;
        generateProceduralPlayerCustomSprite(
          { ...DEFAULT_PLAYER_APPEARANCE, attire: 'balkan-weaver', accentColor: hex },
          'balkan-myth',
        );
      }
      expect(getPlayerSpriteCacheCount()).toBe(24);

      for (let i = 0; i < 72; i++) {
        const appearance = randomizeAppearance({ rng: createSeededRng(i + 101) });
        generateSpriteSheetDataUrl(appearance);
      }
      expect(getSpriteSheetCacheCount()).toBeGreaterThanOrEqual(40);
      expect(getSpriteSheetCacheCount()).toBeLessThanOrEqual(48);

      const imgStats = getImageCacheStats();
      expect(imgStats.totalEntries).toBeGreaterThanOrEqual(0);
      expect(imgStats.dataUrlEntries).toBeGreaterThanOrEqual(0);
      expect(imgStats.loadedEntries).toBeGreaterThanOrEqual(0);
      pruneImageCache();
    } finally {
      clearPlayerSpriteCache();
      clearSpriteSheetCache();
    }
  });
});
