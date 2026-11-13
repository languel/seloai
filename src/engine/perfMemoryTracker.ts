export type MemoryHealthStatus = 'healthy' | 'watch' | 'pressure' | 'leak-risk';

export interface EngineMemorySnapshot {
  id: string;
  label: string;
  backend: 'webgpu' | 'worker-onnx' | 'worker-vision';
  status: string;
  modelId: string;
  liveBytes: number | null;
  peakBytes: number | null;
}

export interface SimMemoryCounters {
  conversationCount: number;
  activeConversationCount: number;
  totalMessages: number;
  villagerCount: number;
  totalMemories: number;
  totalWorldFeedItems: number;
  timelineFrames: number;
  cachedConvSnapshots: number;
}

export interface RuntimeCacheCounters {
  imageCacheCount: number;
  imageCacheDataUrlCount: number;
  spriteSheetCacheCount: number;
  playerSpriteCacheCount: number;
  telemetryEvents: number;
  pendingWorkerRequests: number;
  audioActiveSources: number;
  audioContextState: string;
}

export interface PerfMemorySamplePoint {
  timestamp: number;
  fps: number;
  frameDtAvgMs: number;
  simStepAvgMs: number;
  renderAvgMs: number;
  jsHeapUsedBytes: number | null;
  gpuLiveBytes: number;
  totalMessages: number;
  timelineFrames: number;
}

export interface PerfMemorySnapshot {
  timestamp: number;
  uptimeSec: number;
  fps: number;
  frameDtAvgMs: number;
  frameDtP95Ms: number;
  frameDtMaxMs: number;
  simStepAvgMs: number;
  simStepMaxMs: number;
  renderAvgMs: number;
  renderMaxMs: number;
  longFramesWindow: number;
  totalLongFrames: number;
  jsHeapSupported: boolean;
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  jsHeapLimitBytes: number | null;
  jsHeapPeakBytes: number | null;
  jsHeapSlopeMbPerMin: number;
  gpuLiveBytes: number;
  gpuPeakBytes: number;
  engines: EngineMemorySnapshot[];
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  simStats: SimMemoryCounters;
  caches: RuntimeCacheCounters;
  health: {
    status: MemoryHealthStatus;
    reasons: string[];
  };
  history: PerfMemorySamplePoint[];
}

export interface PerfTelemetryProvider {
  getEngines?: () => EngineMemorySnapshot[];
  getSimCounters?: () => SimMemoryCounters;
  getCacheCounters?: () => RuntimeCacheCounters;
  onCleanup?: (options?: { unloadModels?: boolean }) => Promise<void> | void;
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export function readJsHeapMemory(): {
  supported: boolean;
  usedBytes: number | null;
  totalBytes: number | null;
  limitBytes: number | null;
} {
  if (typeof performance === 'undefined') {
    return { supported: false, usedBytes: null, totalBytes: null, limitBytes: null };
  }
  const mem = (performance as PerformanceWithMemory).memory;
  if (!mem || typeof mem.usedJSHeapSize !== 'number') {
    return { supported: false, usedBytes: null, totalBytes: null, limitBytes: null };
  }
  return {
    supported: true,
    usedBytes: mem.usedJSHeapSize,
    totalBytes: mem.totalJSHeapSize,
    limitBytes: mem.jsHeapSizeLimit,
  };
}

export function computeHeapSlopeMbPerMin(history: PerfMemorySamplePoint[]): number {
  const valid = history.filter((p) => typeof p.jsHeapUsedBytes === 'number' && p.jsHeapUsedBytes >= 0);
  if (valid.length < 4) return 0;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const spanMin = (last.timestamp - first.timestamp) / 60000;
  if (spanMin < 0.08) return 0; // Require >= ~5s window before estimating leak slope

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  const t0 = first.timestamp;
  const y0 = first.jsHeapUsedBytes!;
  for (const pt of valid) {
    const x = (pt.timestamp - t0) / 60000;
    const y = (pt.jsHeapUsedBytes! - y0) / (1024 * 1024);
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const n = valid.length;
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  return Number(slope.toFixed(2));
}

export function evaluateMemoryHealth(
  snapshot: Pick<
    PerfMemorySnapshot,
    | 'jsHeapUsedBytes'
    | 'jsHeapLimitBytes'
    | 'jsHeapSlopeMbPerMin'
    | 'gpuLiveBytes'
    | 'engines'
    | 'simStats'
    | 'caches'
    | 'frameDtP95Ms'
  >,
  history: PerfMemorySamplePoint[],
): { status: MemoryHealthStatus; reasons: string[] } {
  const reasons: string[] = [];
  let severity = 0; // 0=healthy, 1=watch, 2=pressure, 3=leak-risk

  const bump = (lvl: number, msg: string) => {
    severity = Math.max(severity, lvl);
    reasons.push(msg);
  };

  if (snapshot.jsHeapUsedBytes && snapshot.jsHeapLimitBytes && snapshot.jsHeapLimitBytes > 0) {
    const ratio = snapshot.jsHeapUsedBytes / snapshot.jsHeapLimitBytes;
    if (ratio >= 0.85) {
      bump(2, `JS heap at ${Math.round(ratio * 100)}% of tab limit.`);
    } else if (ratio >= 0.68) {
      bump(1, `JS heap elevated (${Math.round(ratio * 100)}% of tab limit).`);
    }
  }

  const heapHistory = history.filter((h) => typeof h.jsHeapUsedBytes === 'number');
  if (heapHistory.length >= 12) {
    const netMb =
      ((heapHistory[heapHistory.length - 1].jsHeapUsedBytes ?? 0) -
        (heapHistory[0].jsHeapUsedBytes ?? 0)) /
      (1024 * 1024);
    if (snapshot.jsHeapSlopeMbPerMin >= 18 && netMb >= 16) {
      bump(3, `Sustained JS heap growth (+${snapshot.jsHeapSlopeMbPerMin.toFixed(1)} MB/min).`);
    } else if (snapshot.jsHeapSlopeMbPerMin >= 8 && netMb >= 10) {
      bump(1, `Upward JS heap trend (+${snapshot.jsHeapSlopeMbPerMin.toFixed(1)} MB/min).`);
    }
  }

  const readyHeavyEngines = snapshot.engines.filter(
    (e) => e.status === 'ready' && (e.backend === 'webgpu' || e.backend === 'worker-onnx'),
  );
  if (readyHeavyEngines.length > 1) {
    bump(
      readyHeavyEngines.length > 2 || snapshot.gpuLiveBytes > 2.6e9 ? 2 : 1,
      `${readyHeavyEngines.length} LLM engines loaded simultaneously (${readyHeavyEngines.map((e) => e.label).join(' + ')}).`,
    );
  }
  if (snapshot.gpuLiveBytes >= 3.2e9) {
    bump(2, `WebGPU live buffers high (${(snapshot.gpuLiveBytes / 1e9).toFixed(2)} GB).`);
  }

  if (snapshot.simStats.timelineFrames > 600) {
    bump(1, `Timeline holding ${snapshot.simStats.timelineFrames} keyframes.`);
  }
  if (snapshot.simStats.totalMessages > 3000) {
    bump(1, `Conversation log holding ${snapshot.simStats.totalMessages} messages.`);
  }
  if (snapshot.caches.imageCacheCount > 90) {
    bump(1, `Image cache holding ${snapshot.caches.imageCacheCount} decoded sheets.`);
  }
  if (snapshot.frameDtP95Ms > 55 && snapshot.frameDtP95Ms < 500) {
    bump(1, `Frame p95 slow (${snapshot.frameDtP95Ms.toFixed(1)} ms).`);
  }

  const status: MemoryHealthStatus =
    severity === 3 ? 'leak-risk' : severity === 2 ? 'pressure' : severity === 1 ? 'watch' : 'healthy';

  return { status, reasons };
}

const FRAME_RING_CAP = 90;
const HISTORY_CAP = 120;

const EMPTY_SIM_STATS: SimMemoryCounters = {
  conversationCount: 0,
  activeConversationCount: 0,
  totalMessages: 0,
  villagerCount: 0,
  totalMemories: 0,
  totalWorldFeedItems: 0,
  timelineFrames: 0,
  cachedConvSnapshots: 0,
};

const EMPTY_CACHE_STATS: RuntimeCacheCounters = {
  imageCacheCount: 0,
  imageCacheDataUrlCount: 0,
  spriteSheetCacheCount: 0,
  playerSpriteCacheCount: 0,
  telemetryEvents: 0,
  pendingWorkerRequests: 0,
  audioActiveSources: 0,
  audioContextState: 'uninitialized',
};

class PerfMemoryTracker {
  private startedAt = Date.now();
  private provider: PerfTelemetryProvider = {};
  private listeners = new Set<(snap: PerfMemorySnapshot) => void>();

  // Fixed typed circular buffers avoid any allocations inside the 60fps animation frame loop.
  private frameDtRing = new Float64Array(FRAME_RING_CAP);
  private simStepRing = new Float64Array(FRAME_RING_CAP);
  private renderRing = new Float64Array(FRAME_RING_CAP);
  private ringCursor = 0;
  private ringFilled = 0;
  private scratchSort = new Float64Array(FRAME_RING_CAP);

  private totalLongFrames = 0;
  private smoothedFps = 60;
  private peakJsHeapBytes = 0;
  private peakGpuBytes = 0;

  private history: PerfMemorySamplePoint[] = [];
  private latestSnapshot: PerfMemorySnapshot | null = null;
  private lastStoragePollAt = 0;
  private storageEstimate: { usage: number | null; quota: number | null } = {
    usage: null,
    quota: null,
  };

  registerProvider(provider: PerfTelemetryProvider) {
    this.provider = { ...this.provider, ...provider };
  }

  /** Called every animation frame — allocation-free hot path. */
  recordFrameSample(rawDtMs: number, simStepMs: number, renderMs: number) {
    const safeDt = Math.max(0.5, Math.min(250, Number.isFinite(rawDtMs) ? rawDtMs : 16.7));
    this.frameDtRing[this.ringCursor] = safeDt;
    this.simStepRing[this.ringCursor] = Math.max(0, Number.isFinite(simStepMs) ? simStepMs : 0);
    this.renderRing[this.ringCursor] = Math.max(0, Number.isFinite(renderMs) ? renderMs : 0);
    this.ringCursor = (this.ringCursor + 1) % FRAME_RING_CAP;
    if (this.ringFilled < FRAME_RING_CAP) this.ringFilled += 1;
    if (safeDt > 50) {
      this.totalLongFrames += 1;
    }
    const instFps = 1000 / Math.max(4, safeDt);
    this.smoothedFps = this.smoothedFps * 0.9 + instFps * 0.1;
  }

  private pollStorageEstimateIfDue(now: number) {
    if (now - this.lastStoragePollAt < 10_000) return;
    this.lastStoragePollAt = now;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((est) => {
          this.storageEstimate = {
            usage: typeof est.usage === 'number' ? est.usage : null,
            quota: typeof est.quota === 'number' ? est.quota : null,
          };
        })
        .catch(() => {});
    }
  }

  captureSnapshot(recordHistory = true): PerfMemorySnapshot {
    const now = Date.now();
    this.pollStorageEstimateIfDue(now);

    const n = this.ringFilled;
    let dtSum = 0;
    let dtMax = 0;
    let simSum = 0;
    let simMax = 0;
    let renSum = 0;
    let renMax = 0;
    let longFramesWindow = 0;

    for (let i = 0; i < n; i++) {
      const dt = this.frameDtRing[i];
      const sm = this.simStepRing[i];
      const rn = this.renderRing[i];
      this.scratchSort[i] = dt;
      dtSum += dt;
      if (dt > dtMax) dtMax = dt;
      if (dt > 50) longFramesWindow += 1;
      simSum += sm;
      if (sm > simMax) simMax = sm;
      renSum += rn;
      if (rn > renMax) renMax = rn;
    }

    let dtP95 = 0;
    if (n > 0) {
      const view = this.scratchSort.subarray(0, n);
      view.sort();
      dtP95 = view[Math.min(n - 1, Math.floor(n * 0.95))];
    }

    const heap = readJsHeapMemory();
    if (heap.usedBytes !== null && heap.usedBytes > this.peakJsHeapBytes) {
      this.peakJsHeapBytes = heap.usedBytes;
    }

    const engines = this.provider.getEngines?.() ?? [];
    const gpuLiveBytes = engines.reduce((acc, e) => acc + (e.liveBytes ?? 0), 0);
    const enginePeakSum = engines.reduce((acc, e) => acc + (e.peakBytes ?? 0), 0);
    this.peakGpuBytes = Math.max(this.peakGpuBytes, gpuLiveBytes, enginePeakSum);

    const simStats = this.provider.getSimCounters?.() ?? EMPTY_SIM_STATS;
    const caches = this.provider.getCacheCounters?.() ?? EMPTY_CACHE_STATS;

    const frameDtAvgMs = n > 0 ? Number((dtSum / n).toFixed(2)) : 0;
    const simStepAvgMs = n > 0 ? Number((simSum / n).toFixed(2)) : 0;
    const renderAvgMs = n > 0 ? Number((renSum / n).toFixed(2)) : 0;
    const fps = n > 0 ? Math.max(0, Math.round(this.smoothedFps)) : 0;

    if (recordHistory) {
      const point: PerfMemorySamplePoint = {
        timestamp: now,
        fps,
        frameDtAvgMs,
        simStepAvgMs,
        renderAvgMs,
        jsHeapUsedBytes: heap.usedBytes,
        gpuLiveBytes,
        totalMessages: simStats.totalMessages,
        timelineFrames: simStats.timelineFrames,
      };
      this.history.push(point);
      if (this.history.length > HISTORY_CAP) {
        this.history.shift();
      }
    }

    const jsHeapSlopeMbPerMin = computeHeapSlopeMbPerMin(this.history);
    const partial = {
      timestamp: now,
      uptimeSec: Math.round((now - this.startedAt) / 1000),
      fps,
      frameDtAvgMs,
      frameDtP95Ms: Number(dtP95.toFixed(2)),
      frameDtMaxMs: Number(dtMax.toFixed(2)),
      simStepAvgMs,
      simStepMaxMs: Number(simMax.toFixed(2)),
      renderAvgMs,
      renderMaxMs: Number(renMax.toFixed(2)),
      longFramesWindow,
      totalLongFrames: this.totalLongFrames,
      jsHeapSupported: heap.supported,
      jsHeapUsedBytes: heap.usedBytes,
      jsHeapTotalBytes: heap.totalBytes,
      jsHeapLimitBytes: heap.limitBytes,
      jsHeapPeakBytes: heap.supported ? this.peakJsHeapBytes : null,
      jsHeapSlopeMbPerMin,
      gpuLiveBytes,
      gpuPeakBytes: this.peakGpuBytes,
      engines,
      storageUsageBytes: this.storageEstimate.usage,
      storageQuotaBytes: this.storageEstimate.quota,
      simStats,
      caches,
    };

    const health = evaluateMemoryHealth(partial, this.history);
    const snapshot: PerfMemorySnapshot = {
      ...partial,
      health,
      history: [...this.history],
    };
    this.latestSnapshot = snapshot;
    for (const fn of this.listeners) fn(snapshot);
    return snapshot;
  }

  getLatestSnapshot(): PerfMemorySnapshot {
    return this.latestSnapshot ?? this.captureSnapshot(false);
  }

  subscribe(fn: (snap: PerfMemorySnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.getLatestSnapshot());
    return () => this.listeners.delete(fn);
  }

  async runCleanup(options?: { unloadModels?: boolean }): Promise<PerfMemorySnapshot> {
    await this.provider.onCleanup?.(options);
    return this.captureSnapshot(true);
  }

  resetPeaks(): PerfMemorySnapshot {
    const heap = readJsHeapMemory();
    this.peakJsHeapBytes = heap.usedBytes ?? 0;
    const engines = this.provider.getEngines?.() ?? [];
    this.peakGpuBytes = engines.reduce((acc, e) => acc + (e.liveBytes ?? 0), 0);
    this.totalLongFrames = 0;
    this.history = [];
    return this.captureSnapshot(true);
  }

  exportDiagnosticsJson(): string {
    const snap = this.captureSnapshot(false);
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
        deviceMemoryGb:
          typeof navigator !== 'undefined' && 'deviceMemory' in navigator
            ? (navigator as { deviceMemory?: number }).deviceMemory ?? null
            : null,
        hardwareConcurrency:
          typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? null : null,
        snapshot: snap,
      },
      null,
      2,
    );
  }
}

export const perfMemoryTracker = new PerfMemoryTracker();
