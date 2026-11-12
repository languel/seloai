import {
  AutoModelForMaskGeneration,
  AutoProcessor,
  env,
  pipeline,
  RawImage,
} from '@huggingface/transformers';
import {
  extractRegionsFromMatte,
  filterMaskCandidatesNMS,
  type CropSelection,
  type SegmentedMaskCandidate,
} from '../engine/tapestrySampler';
import { resolvePublicUrl } from '../utils/assetUrl';
import type { SegmentationModelPreset } from '../ai/segmentationClient';

env.localModelPath = resolvePublicUrl('/models/');
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.useBrowserCache = true;

let loadedPresetId = '';
let loadedDevice: 'webgpu' | 'wasm' = 'wasm';
let samModel: any = null;
let samProcessor: any = null;
let activePipeline: any = null;

let cachedSamImageSig = '';
let cachedSamImageState: {
  original_sizes: any;
  reshaped_input_sizes: any;
  encoded: Record<string, any>;
} | null = null;

function post(msg: unknown, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}

async function detectWebGpuSupport(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) return false;
    const adapter = await (navigator as any).gpu?.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function rgbaBufferToRawImageRgb(rgbaBuffer: ArrayBuffer, width: number, height: number): {
  rawImage: RawImage;
  sig: string;
} {
  const rgba = new Uint8ClampedArray(rgbaBuffer);
  const total = width * height;
  const rgb = new Uint8ClampedArray(total * 3);
  let sampleHash = 2166136261;
  const stride = Math.max(1, Math.floor(total / 256));
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const q = i * 3;
    rgb[q] = rgba[p];
    rgb[q + 1] = rgba[p + 1];
    rgb[q + 2] = rgba[p + 2];
    if (i % stride === 0) {
      sampleHash ^= (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
      sampleHash = Math.imul(sampleHash, 16777619);
    }
  }
  return {
    rawImage: new RawImage(rgb, width, height, 3),
    sig: `${width}x${height}:${sampleHash >>> 0}`,
  };
}

async function unloadAll() {
  if (samModel?.dispose) {
    await samModel.dispose().catch(() => {});
  }
  if (activePipeline?.dispose) {
    await activePipeline.dispose().catch(() => {});
  }
  samModel = null;
  samProcessor = null;
  activePipeline = null;
  cachedSamImageSig = '';
  cachedSamImageState = null;
  loadedPresetId = '';
}

async function ensureModelLoaded(preset: SegmentationModelPreset): Promise<{ device: 'webgpu' | 'wasm' }> {
  if (loadedPresetId === preset.id && (samModel || activePipeline)) {
    return { device: loadedDevice };
  }

  await unloadAll();

  const hasWebGpu = await detectWebGpuSupport();
  const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: any }> = [];
  if (hasWebGpu) {
    attempts.push({ device: 'webgpu', dtype: preset.webgpuDtype });
  }
  attempts.push({ device: 'wasm', dtype: preset.wasmDtype });
  if (preset.wasmDtype !== 'quantized') {
    attempts.push({ device: 'wasm', dtype: 'quantized' });
  }

  let lastErr: unknown = null;

  for (const attempt of attempts) {
    try {
      const fileProgress = new Map<string, { loaded: number; total: number }>();
      const progress_callback = (info: any) => {
        if (info?.file && typeof info.loaded === 'number' && typeof info.total === 'number' && info.total > 0) {
          fileProgress.set(info.file, { loaded: info.loaded, total: info.total });
          let loaded = 0;
          let total = 0;
          for (const e of fileProgress.values()) {
            loaded += e.loaded;
            total += e.total;
          }
          const fraction = total > 0 ? Math.min(0.98, loaded / total) : 0;
          post({
            type: 'status',
            status: 'loading',
            modelId: preset.id,
            device: attempt.device,
            fraction,
            message: `Downloading ${preset.label.split('(')[0].trim()} [${attempt.device.toUpperCase()}] (${Math.round(fraction * 100)}%)`,
          });
        }
      };

      post({
        type: 'status',
        status: 'loading',
        modelId: preset.id,
        device: attempt.device,
        fraction: 0.03,
        message: `Loading ${preset.label.split('(')[0].trim()} on ${attempt.device.toUpperCase()}…`,
      });

      if (preset.kind === 'sam') {
        samProcessor = await AutoProcessor.from_pretrained(preset.repoId, { progress_callback });
        samModel = await AutoModelForMaskGeneration.from_pretrained(preset.repoId, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback,
        });
      } else if (preset.kind === 'zero-shot-det') {
        activePipeline = await pipeline('zero-shot-object-detection', preset.repoId, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback,
        });
      } else if (preset.kind === 'object-det') {
        activePipeline = await pipeline('object-detection', preset.repoId, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback,
        });
      } else if (preset.kind === 'matting') {
        activePipeline = await pipeline('background-removal', preset.repoId, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback,
        });
      }

      loadedPresetId = preset.id;
      loadedDevice = attempt.device;
      post({
        type: 'status',
        status: 'ready',
        modelId: preset.id,
        device: attempt.device,
        fraction: 1,
        message: `${preset.label.split('(')[0].trim()} ready (${attempt.device.toUpperCase()})`,
      });
      return { device: attempt.device };
    } catch (err) {
      lastErr = err;
      await unloadAll();
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'Failed to load model'));
}

async function ensureSamEncoded(rawImage: RawImage, sig: string, preset: SegmentationModelPreset) {
  if (cachedSamImageState && cachedSamImageSig === `${preset.id}:${sig}`) {
    return cachedSamImageState;
  }
  post({
    type: 'status',
    status: 'running',
    modelId: preset.id,
    device: loadedDevice,
    fraction: 0.25,
    message: `Encoding image embeddings with ${preset.label.split('(')[0].trim()}…`,
  });
  const imageInputs = await samProcessor(rawImage);
  const encoded = await samModel.get_image_embeddings(imageInputs);
  cachedSamImageSig = `${preset.id}:${sig}`;
  cachedSamImageState = {
    original_sizes: imageInputs.original_sizes,
    reshaped_input_sizes: imageInputs.reshaped_input_sizes,
    encoded,
  };
  return cachedSamImageState;
}

async function decodeSamPrompt(
  samState: NonNullable<typeof cachedSamImageState>,
  imgW: number,
  imgH: number,
  prompt: { point?: { x: number; y: number; positive?: boolean }; box?: CropSelection },
): Promise<SegmentedMaskCandidate | null> {
  const { original_sizes, reshaped_input_sizes, encoded } = samState;
  let outputs: any;
  if (prompt.point) {
    const px = Math.max(0, Math.min(imgW - 1, Math.round(prompt.point.x)));
    const py = Math.max(0, Math.min(imgH - 1, Math.round(prompt.point.y)));
    const input_points = samProcessor.reshape_input_points(
      [[[[px, py]]]],
      original_sizes,
      reshaped_input_sizes,
    );
    const input_labels = samProcessor.add_input_labels(
      [[[prompt.point.positive === false ? 0 : 1]]],
      input_points,
    );
    outputs = await samModel({ ...encoded, input_points, input_labels });
  } else if (prompt.box) {
    const x0 = Math.max(0, Math.round(prompt.box.x));
    const y0 = Math.max(0, Math.round(prompt.box.y));
    const x1 = Math.min(imgW - 1, Math.round(prompt.box.x + prompt.box.w));
    const y1 = Math.min(imgH - 1, Math.round(prompt.box.y + prompt.box.h));
    const input_boxes = samProcessor.reshape_input_points(
      [[[[x0, y0, x1, y1]]]],
      original_sizes,
      reshaped_input_sizes,
      true,
    );
    outputs = await samModel({ ...encoded, input_boxes });
  } else {
    return null;
  }

  const processedMasks = await samProcessor.post_process_masks(
    outputs.pred_masks,
    original_sizes,
    reshaped_input_sizes,
    { binarize: true },
  );
  const maskTensor = processedMasks?.[0];
  if (!maskTensor) return null;

  // maskTensor.dims is usually [num_prompts(1), num_masks(3), H, W] or [num_masks(3), H, W]
  const dims: number[] = maskTensor.dims;
  const numMasks = dims.length >= 4 ? dims[1] : dims.length === 3 ? dims[0] : 1;
  const maskH = dims[dims.length - 2];
  const maskW = dims[dims.length - 1];
  const planeSize = maskW * maskH;

  const rawMask = maskTensor.data as Uint8Array;
  const scoresArr = outputs.iou_scores?.data ?? [];
  const totalPixels = maskW * maskH;

  // Pick the highest-IoU mask that isn't a full-page background mask (>65% of image)
  let bestK = -1;
  let bestScore = -Infinity;
  for (let k = 0; k < numMasks; k++) {
    const s = Number(scoresArr[k] ?? 0);
    const offset = k * planeSize;
    let count = 0;
    for (let i = 0; i < totalPixels; i += 4) {
      if (rawMask[offset + i] > 0) count += 4;
    }
    const frac = count / Math.max(1, totalPixels);
    if (frac <= 0.65 && frac >= 0.0004 && s > bestScore) {
      bestScore = s;
      bestK = k;
    }
  }
  if (bestK < 0) return null;

  const offset = bestK * planeSize;
  let minX = maskW;
  let minY = maskH;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < maskH; y++) {
    const rowOff = offset + y * maskW;
    for (let x = 0; x < maskW; x++) {
      if (rawMask[rowOff + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const cropMask = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    const srcRow = offset + (minY + y) * maskW + minX;
    for (let x = 0; x < cw; x++) {
      cropMask[y * cw + x] = rawMask[srcRow + x] > 0 ? 1 : 0;
    }
  }

  return {
    crop: { x: minX, y: minY, w: cw, h: ch },
    mask: cropMask,
    score: Number.isFinite(bestScore) && bestScore > -10 ? bestScore : 0.7,
  };
}

function detBoxToCandidate(
  det: { label?: string; score?: number; box?: { xmin: number; ymin: number; xmax: number; ymax: number } },
  imgW: number,
  imgH: number,
): SegmentedMaskCandidate | null {
  const b = det?.box;
  if (!b) return null;
  const x0 = Math.max(0, Math.floor(Number(b.xmin)));
  const y0 = Math.max(0, Math.floor(Number(b.ymin)));
  const x1 = Math.min(imgW, Math.ceil(Number(b.xmax)));
  const y1 = Math.min(imgH, Math.ceil(Number(b.ymax)));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const mask = new Uint8Array(w * h);
  mask.fill(1);
  return {
    crop: { x: x0, y: y0, w, h },
    mask,
    score: Number(det.score ?? 0.5),
    label: det.label ? String(det.label) : undefined,
  };
}

self.onmessage = async (e: MessageEvent<any>) => {
  const cmd = e.data;
  if (!cmd || !cmd.requestId) return;
  const requestId = String(cmd.requestId);

  try {
    if (cmd.type === 'unload') {
      await unloadAll();
      post({ type: 'result', requestId, payload: { ok: true } });
      return;
    }

    if (cmd.type === 'load') {
      const res = await ensureModelLoaded(cmd.preset);
      post({ type: 'result', requestId, payload: res });
      return;
    }

    if (cmd.type === 'segment_prompt') {
      const preset: SegmentationModelPreset = cmd.preset;
      await ensureModelLoaded(preset);
      const { rawImage, sig } = rgbaBufferToRawImageRgb(cmd.rgba, cmd.width, cmd.height);
      const samState = await ensureSamEncoded(rawImage, sig, preset);
      post({
        type: 'status',
        status: 'running',
        modelId: preset.id,
        device: loadedDevice,
        fraction: 0.7,
        message: 'Decoding mask at prompt…',
      });
      const cand = await decodeSamPrompt(samState, cmd.width, cmd.height, {
        point: cmd.point,
        box: cmd.box,
      });
      post({
        type: 'status',
        status: 'ready',
        modelId: preset.id,
        device: loadedDevice,
        fraction: 1,
        message: cand ? `Segmented ${cand.crop.w}×${cand.crop.h}px motif` : 'No object mask at point',
      });
      const transfer = cand?.mask ? [cand.mask.buffer] : [];
      post({ type: 'result', requestId, payload: cand }, transfer);
      return;
    }

    if (cmd.type === 'auto_segment') {
      const preset: SegmentationModelPreset = cmd.preset;
      await ensureModelLoaded(preset);
      const { rawImage, sig } = rgbaBufferToRawImageRgb(cmd.rgba, cmd.width, cmd.height);
      const minSize = Number(cmd.minSize ?? 10);
      const mergeGap = Number(cmd.mergeGap ?? 6);
      const scoreThreshold = Number(cmd.scoreThreshold ?? 0.2);

      let candidates: SegmentedMaskCandidate[] = [];
      let matteAlpha: Uint8Array | undefined;

      if (preset.kind === 'sam') {
        const samState = await ensureSamEncoded(rawImage, sig, preset);
        const seeds: Array<{ x: number; y: number; score: number }> = Array.isArray(cmd.seeds) ? cmd.seeds : [];
        const rawCands: SegmentedMaskCandidate[] = [];
        for (let i = 0; i < seeds.length; i++) {
          if (i % 3 === 0 || i === seeds.length - 1) {
            post({
              type: 'status',
              status: 'running',
              modelId: preset.id,
              device: loadedDevice,
              fraction: 0.3 + (0.65 * (i + 1)) / Math.max(1, seeds.length),
              message: `Segmenting motifs ${i + 1}/${seeds.length}…`,
            });
          }
          const cand = await decodeSamPrompt(samState, cmd.width, cmd.height, {
            point: { x: seeds[i].x, y: seeds[i].y, positive: true },
          });
          if (cand) rawCands.push(cand);
        }
        candidates = filterMaskCandidatesNMS(rawCands, cmd.width, cmd.height, 0.55, minSize);
      } else if (preset.kind === 'zero-shot-det') {
        post({
          type: 'status',
          status: 'running',
          modelId: preset.id,
          device: loadedDevice,
          fraction: 0.5,
          message: 'Running Grounding DINO prompt detection…',
        });
        const labels = String(cmd.textPrompt || '')
          .split(/[.,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        const dets = await activePipeline(
          rawImage,
          labels.length > 0 ? labels : ['motif', 'pattern', 'ornament', 'object'],
          { threshold: scoreThreshold, percentage: false },
        );
        const rawCands = (Array.isArray(dets) ? dets : [])
          .map((d: any) => detBoxToCandidate(d, cmd.width, cmd.height))
          .filter((c): c is SegmentedMaskCandidate => Boolean(c));
        candidates = filterMaskCandidatesNMS(rawCands, cmd.width, cmd.height, 0.55, minSize);
      } else if (preset.kind === 'object-det') {
        post({
          type: 'status',
          status: 'running',
          modelId: preset.id,
          device: loadedDevice,
          fraction: 0.5,
          message: 'Running YOLOS object detection…',
        });
        const dets = await activePipeline(rawImage, { threshold: scoreThreshold, percentage: false });
        const rawCands = (Array.isArray(dets) ? dets : [])
          .map((d: any) => detBoxToCandidate(d, cmd.width, cmd.height))
          .filter((c): c is SegmentedMaskCandidate => Boolean(c));
        candidates = filterMaskCandidatesNMS(rawCands, cmd.width, cmd.height, 0.55, minSize);
      } else if (preset.kind === 'matting') {
        post({
          type: 'status',
          status: 'running',
          modelId: preset.id,
          device: loadedDevice,
          fraction: 0.5,
          message: 'Removing background via ORMBG matte…',
        });
        const matteImg: RawImage = await activePipeline(rawImage);
        const rgbaOut = matteImg.data as Uint8Array;
        matteAlpha = new Uint8Array(cmd.width * cmd.height);
        for (let i = 0; i < matteAlpha.length; i++) {
          matteAlpha[i] = matteImg.channels === 4 ? rgbaOut[i * 4 + 3] : rgbaOut[i];
        }
        candidates = extractRegionsFromMatte(matteAlpha, cmd.width, cmd.height, {
          minSize,
          mergeGap,
          matteThreshold: 112,
        });
      }

      post({
        type: 'status',
        status: 'ready',
        modelId: preset.id,
        device: loadedDevice,
        fraction: 1,
        message: `Detected ${candidates.length} motifs (${loadedDevice.toUpperCase()})`,
      });

      const transfer: Transferable[] = [];
      for (const c of candidates) {
        if (c.mask?.buffer) transfer.push(c.mask.buffer);
      }
      if (matteAlpha?.buffer) transfer.push(matteAlpha.buffer);

      post(
        {
          type: 'result',
          requestId,
          payload: { candidates, matteAlpha, device: loadedDevice },
        },
        transfer,
      );
      return;
    }

    throw new Error(`Unknown segmentation worker command "${cmd.type}"`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({
      type: 'status',
      status: 'error',
      modelId: cmd?.preset?.id ?? null,
      device: loadedDevice,
      fraction: 0,
      message,
    });
    post({ type: 'error', requestId, error: message });
  }
};
