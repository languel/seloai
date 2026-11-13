import type { BrainEngineKind, ModelSettings, TextDtype } from '../engine/types';
import { resolveOriginUrl } from '../utils/assetUrl';

export const LAST_LOADED_MODEL_STORAGE_KEY = 'seloai:last-loaded-model-v1';
export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';
export const GGUF_CACHE_DB_NAME = 'gguf-cache-v1';

export interface ModelCacheSpec {
  brainEngine: BrainEngineKind;
  modelId: string;
  textDtype?: TextDtype;
  omniMmproj?: string;
}

export interface LastLoadedModelRecord extends ModelCacheSpec {
  textDtype: TextDtype;
  loadedAt: number;
}

export type DownloadedModelSource = 'browser-cache' | 'indexeddb-gguf' | 'local-models' | 'none';

export interface DownloadedModelProbe {
  downloaded: boolean;
  source: DownloadedModelSource;
  detail: string;
  cachedBytes?: number;
}

export function getLastLoadedModel(): LastLoadedModelRecord | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LAST_LOADED_MODEL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastLoadedModelRecord>;
    if (
      !parsed ||
      typeof parsed.modelId !== 'string' ||
      !parsed.modelId.trim() ||
      (parsed.brainEngine !== 'transformers-onnx' &&
        parsed.brainEngine !== 'lfm3-omni' &&
        parsed.brainEngine !== 'minicpm5-gguf' &&
        parsed.brainEngine !== 'bonsai2-gguf')
    ) {
      return null;
    }
    return {
      brainEngine: parsed.brainEngine,
      modelId: parsed.modelId.trim(),
      textDtype: parsed.textDtype ?? 'q4f16',
      omniMmproj: typeof parsed.omniMmproj === 'string' && parsed.omniMmproj.trim() ? parsed.omniMmproj.trim() : undefined,
      loadedAt: typeof parsed.loadedAt === 'number' ? parsed.loadedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveLastLoadedModel(record: Omit<LastLoadedModelRecord, 'loadedAt'> & { loadedAt?: number }): void {
  try {
    if (typeof localStorage === 'undefined' || !record.modelId.trim()) return;
    const clean: LastLoadedModelRecord = {
      brainEngine: record.brainEngine,
      modelId: record.modelId.trim(),
      textDtype: record.textDtype ?? 'q4f16',
      omniMmproj: record.omniMmproj?.trim() || undefined,
      loadedAt: record.loadedAt ?? Date.now(),
    };
    localStorage.setItem(LAST_LOADED_MODEL_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage quota or sandbox restriction errors
  }
}

export function clearLastLoadedModel(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LAST_LOADED_MODEL_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function normalizeSpecFromSettings(settings: ModelSettings): LastLoadedModelRecord {
  const isOmni = settings.brainEngine === 'lfm3-omni';
  return {
    brainEngine: settings.brainEngine,
    modelId: (isOmni ? settings.omniModelId : settings.textModelId).trim(),
    textDtype: settings.textDtype,
    omniMmproj: isOmni ? settings.omniMmproj.trim() || undefined : undefined,
    loadedAt: 0,
  };
}

/**
 * Pure URL matcher for Transformers.js Cache Storage entries (`transformers-cache`).
 * Confirms an ONNX weight artifact for the requested modelId and quantization dtype is present.
 */
export function matchesTransformersCacheEntries(
  urls: string[],
  modelId: string,
  dtype: TextDtype = 'q4f16',
): boolean {
  const cleanId = modelId.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!cleanId) return false;
  const encodedId = encodeURIComponent(cleanId);
  const dtypeLower = dtype.toLowerCase();

  let hasWeightFile = false;
  for (const rawUrl of urls) {
    const lower = rawUrl.toLowerCase();
    const decoded = (() => {
      try {
        return decodeURIComponent(lower);
      } catch {
        return lower;
      }
    })();
    if (!decoded.includes(cleanId) && !lower.includes(encodedId)) continue;

    // Must match at least one .onnx or .onnx_data file corresponding to dtype
    if (decoded.endsWith('.onnx') || decoded.endsWith('.onnx_data')) {
      if (
        decoded.includes(`_${dtypeLower}.onnx`) ||
        decoded.includes(`-${dtypeLower}.onnx`) ||
        decoded.includes(`.${dtypeLower}.onnx`) ||
        (dtypeLower === 'fp16' && decoded.endsWith('fp16.onnx')) ||
        (dtypeLower === 'q4' && decoded.includes('_quantized.onnx'))
      ) {
        hasWeightFile = true;
        break;
      }
    }
  }
  return hasWeightFile;
}

/**
 * Sums non-overlapping [begin, end) byte intervals covered by cached GGUF chunks.
 */
export function computeCoveredByteSpan(ranges: Array<[number, number]>): number {
  const valid = ranges
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  if (valid.length === 0) return 0;

  let total = 0;
  let curStart = valid[0]![0];
  let curEnd = valid[0]![1];
  for (let i = 1; i < valid.length; i++) {
    const [s, e] = valid[i]!;
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total;
}

function matchesGgufCacheKey(cacheKey: string, modelId: string): boolean {
  const lowerKey = decodeSafe(cacheKey).toLowerCase();
  // Exclude standalone mmproj entries so we confirm the primary LLM weights themselves are cached
  if (lowerKey.includes('/mmproj-') || lowerKey.startsWith('mmproj-')) return false;
  const cleanId = modelId.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!cleanId) return false;
  if (lowerKey.includes(cleanId)) return true;
  const repoSlug = cleanId.split('/').pop() ?? cleanId;
  const baseName = repoSlug.replace(/-gguf$/i, '');
  return baseName.length >= 4 && lowerKey.includes(baseName) && lowerKey.includes('.gguf');
}

function decodeSafe(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

async function probeTransformersCache(modelId: string, dtype: TextDtype): Promise<DownloadedModelProbe | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const hasNamed = typeof caches.has === 'function' ? await caches.has(TRANSFORMERS_CACHE_NAME) : true;
    if (!hasNamed) return null;
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const reqs = await cache.keys();
    const urls = reqs.map((r) => r.url);
    if (matchesTransformersCacheEntries(urls, modelId, dtype)) {
      return {
        downloaded: true,
        source: 'browser-cache',
        detail: `${modelId} (${dtype}) cached in browser Cache Storage`,
      };
    }
  } catch {
    // Ignore cache API errors
  }
  return null;
}

async function openExistingGgufCacheDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === GGUF_CACHE_DB_NAME)) {
        return null;
      }
    }
  } catch {
    // Fall back to careful open below
  }

  return new Promise((resolve) => {
    let abortedMissing = false;
    try {
      const req = indexedDB.open(GGUF_CACHE_DB_NAME);
      req.onupgradeneeded = () => {
        // Avoid creating an empty gguf-cache-v1 DB if it did not exist yet
        abortedMissing = true;
        try {
          req.transaction?.abort();
        } catch {
          // ignore
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (abortedMissing || !db.objectStoreNames.contains('meta') || !db.objectStoreNames.contains('chunks')) {
          db.close();
          resolve(null);
          return;
        }
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function probeGgufIndexedDb(modelId: string): Promise<DownloadedModelProbe | null> {
  const db = await openExistingGgufCacheDb();
  if (!db) return null;

  try {
    const metaEntries = await new Promise<Array<{ key: string; size: number }>>((resolve) => {
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const keys = Array.isArray(keysReq.result) ? keysReq.result : [];
        const vals = Array.isArray(valsReq.result) ? valsReq.result : [];
        const out: Array<{ key: string; size: number }> = [];
        for (let i = 0; i < keys.length; i++) {
          const keyStr = String(keys[i] ?? '');
          const sizeVal = Number((vals[i] as any)?.size ?? 0);
          out.push({ key: keyStr, size: Number.isFinite(sizeVal) ? sizeVal : 0 });
        }
        resolve(out);
      };
      tx.onerror = () => resolve([]);
    });

    const matchingMeta = metaEntries.filter((entry) => matchesGgufCacheKey(entry.key, modelId));
    for (const meta of matchingMeta) {
      const chunkKeys = await new Promise<Array<[string, number, number]>>((resolve) => {
        const tx = db.transaction('chunks', 'readonly');
        const store = tx.objectStore('chunks');
        const range = IDBKeyRange.bound([meta.key], [meta.key, [], []]);
        const keysReq = store.getAllKeys(range);
        keysReq.onsuccess = () => {
          const rawKeys = Array.isArray(keysReq.result) ? keysReq.result : [];
          resolve(
            rawKeys.filter(
              (k): k is [string, number, number] =>
                Array.isArray(k) && k.length >= 3 && typeof k[1] === 'number' && typeof k[2] === 'number',
            ),
          );
        };
        keysReq.onerror = () => resolve([]);
      });

      const covered = computeCoveredByteSpan(chunkKeys.map((k) => [k[1], k[2]]));
      // Confirm substantial weights are cached locally (either >= 55% of GGUF or >= 1MB if meta.size unavailable)
      const isSubstantial =
        meta.size > 0 ? covered >= meta.size * 0.55 : covered >= 1_000_000;
      if (isSubstantial) {
        return {
          downloaded: true,
          source: 'indexeddb-gguf',
          cachedBytes: covered,
          detail: `${modelId} cached in IndexedDB (${Math.round(covered / 1e6)} MB)`,
        };
      }
    }
  } catch {
    // Ignore IDB inspection failure
  } finally {
    db.close();
  }
  return null;
}

export async function headBinaryAssetExists(
  url: string,
  minBytes = 65_536,
): Promise<{ exists: boolean; bytes: number }> {
  if (typeof fetch !== 'function') return { exists: false, bytes: 0 };
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return { exists: false, bytes: 0 };
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    // Reject SPA HTML fallbacks served on 200 OK by Vite or static hosts
    if (ct.includes('text/html')) return { exists: false, bytes: 0 };
    const rawLen = res.headers.get('content-length');
    if (rawLen !== null) {
      const bytes = Number(rawLen);
      if (Number.isFinite(bytes) && bytes < minBytes) {
        return { exists: false, bytes };
      }
      return { exists: true, bytes: Number.isFinite(bytes) ? bytes : 0 };
    }
    return { exists: true, bytes: 0 };
  } catch {
    return { exists: false, bytes: 0 };
  }
}

async function probeLocalHostedModel(spec: ModelCacheSpec): Promise<DownloadedModelProbe | null> {
  if (typeof globalThis.location === 'undefined' || globalThis.location.origin === 'null') {
    return null;
  }
  const trimmed = spec.modelId.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed || /^https?:/i.test(trimmed)) return null;

  if (spec.brainEngine === 'lfm3-omni') {
    const repoName = (trimmed.split('/').pop() ?? trimmed).replace(/-GGUF$/i, '');
    const localBase = resolveOriginUrl(`/models/${trimmed}`);
    const ggufUrl = `${localBase}/${repoName}-Q4_K_M.gguf`;
    const mmprojUrl = spec.omniMmproj?.trim()
      ? spec.omniMmproj.startsWith('/') || /^https?:/i.test(spec.omniMmproj)
        ? spec.omniMmproj
        : `${localBase}/${spec.omniMmproj}`
      : `${localBase}/mmproj-${repoName}-Q8_0.gguf`;
    const [r1, r2] = await Promise.all([
      headBinaryAssetExists(ggufUrl),
      headBinaryAssetExists(mmprojUrl),
    ]);
    if (r1.exists && r2.exists) {
      return {
        downloaded: true,
        source: 'local-models',
        cachedBytes: r1.bytes + r2.bytes,
        detail: `Local /models/${trimmed} ready`,
      };
    }
    return null;
  }

  if (spec.brainEngine === 'transformers-onnx') {
    const dtype = spec.textDtype ?? 'q4f16';
    const candidateUrls = [
      resolveOriginUrl(`/models/${trimmed}/onnx/model_${dtype}.onnx`),
      resolveOriginUrl(`/models/${trimmed}/onnx/decoder_model_merged_${dtype}.onnx`),
      resolveOriginUrl(`/models/${trimmed}/onnx/model.onnx`),
    ];
    for (const url of candidateUrls) {
      const res = await headBinaryAssetExists(url, 4096);
      if (res.exists) {
        return {
          downloaded: true,
          source: 'local-models',
          cachedBytes: res.bytes || undefined,
          detail: `Local /models/${trimmed} (${dtype}) ready`,
        };
      }
    }
    return null;
  }

  if (spec.brainEngine === 'bonsai2-gguf' || spec.brainEngine === 'minicpm5-gguf') {
    const repoName = (trimmed.split('/').pop() ?? trimmed).replace(/-GGUF$/i, '');
    const localBase = resolveOriginUrl(`/models/${trimmed}`);
    const ggufUrl =
      spec.brainEngine === 'bonsai2-gguf'
        ? `${localBase}/Ternary-Bonsai-2-27B-PTQ1_0.gguf`
        : `${localBase}/${repoName}-Q4_K_M.gguf`;
    const res = await headBinaryAssetExists(ggufUrl);
    if (res.exists) {
      return {
        downloaded: true,
        source: 'local-models',
        cachedBytes: res.bytes || undefined,
        detail: `Local /models/${trimmed} ready`,
      };
    }
  }

  return null;
}

export async function checkModelDownloaded(spec: ModelCacheSpec): Promise<DownloadedModelProbe> {
  if (!spec.modelId.trim()) {
    return { downloaded: false, source: 'none', detail: 'No model ID specified' };
  }

  const cacheProbe =
    spec.brainEngine === 'transformers-onnx'
      ? await probeTransformersCache(spec.modelId, spec.textDtype ?? 'q4f16')
      : await probeGgufIndexedDb(spec.modelId);
  if (cacheProbe) return cacheProbe;

  const localProbe = await probeLocalHostedModel(spec);
  if (localProbe) return localProbe;

  return {
    downloaded: false,
    source: 'none',
    detail: 'Not downloaded locally yet',
  };
}

export async function hasWebGpuAdapter(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
  try {
    const adapter = await (navigator as any).gpu?.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

export interface AutoLoadCandidate {
  spec: LastLoadedModelRecord;
  probe: DownloadedModelProbe;
}

/**
 * Resolves whether the app should automatically load a locally downloaded model on startup.
 * Prioritizes the last explicitly loaded model (browser cache or local /models/),
 * and otherwise only auto-loads if the active model already resides in browser cache.
 */
export async function resolveStartupAutoLoadCandidate(
  settings: ModelSettings,
): Promise<AutoLoadCandidate | null> {
  if (settings.autoLoadCachedModel === false) return null;
  if (settings.inferenceMode === 'story-sim' || settings.inferenceMode === 'local-api') {
    return null;
  }
  if (!(await hasWebGpuAdapter())) return null;

  const lastUsed = getLastLoadedModel();
  if (lastUsed) {
    const probe = await checkModelDownloaded(lastUsed);
    if (probe.downloaded) {
      return { spec: lastUsed, probe };
    }
  }

  // Fallback for users who cached a model before last-used tracking existed:
  // only auto-load from explicit browser cache (transformers-cache / gguf-cache-v1),
  // avoiding unexpected VRAM allocation on a first visit just because dev /models exist.
  const currentSpec = normalizeSpecFromSettings(settings);
  const currentProbe = await checkModelDownloaded(currentSpec);
  if (
    currentProbe.downloaded &&
    (currentProbe.source === 'browser-cache' || currentProbe.source === 'indexeddb-gguf')
  ) {
    return { spec: currentSpec, probe: currentProbe };
  }

  return null;
}
