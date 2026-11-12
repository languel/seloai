import type { CropSelection, SegmentedMaskCandidate } from '../engine/tapestrySampler';

export type SegmentationModelId =
  | 'contrast-fast'
  | 'edgetam'
  | 'sam2-tiny'
  | 'sam3-tracker'
  | 'grounding-dino'
  | 'yolos-tiny'
  | 'ormbg';

export type SegmentationModelKind = 'heuristic' | 'sam' | 'zero-shot-det' | 'object-det' | 'matting';

export interface SegmentationModelPreset {
  id: SegmentationModelId;
  label: string;
  repoId: string;
  kind: SegmentationModelKind;
  approxSize: string;
  supportsClickPrompt: boolean;
  webgpuDtype: string | Record<string, string>;
  wasmDtype: string;
  description: string;
}

export const SEGMENTATION_MODEL_PRESETS: SegmentationModelPreset[] = [
  {
    id: 'contrast-fast',
    label: 'Smart Contrast (Instant · 0 MB)',
    repoId: 'local/contrast-salience',
    kind: 'heuristic',
    approxSize: '0 MB',
    supportsClickPrompt: false,
    webgpuDtype: 'cpu',
    wasmDtype: 'cpu',
    description:
      'Instant background-mode & contour-line-breaking slicer. Separates motifs even inside closed outlines.',
  },
  {
    id: 'edgetam',
    label: 'EdgeTAM · SAM 2 (~14 MB · WebGPU)',
    repoId: 'onnx-community/edgetam-ONNX',
    kind: 'sam',
    approxSize: '~14 MB',
    supportsClickPrompt: true,
    webgpuDtype: { vision_encoder: 'fp16', prompt_encoder_mask_decoder: 'q4f16' },
    wasmDtype: 'int8',
    description:
      'Meta EdgeTAM (SAM2 architecture). Supports Auto-Segment All AND Click-to-Segment motifs directly.',
  },
  {
    id: 'sam2-tiny',
    label: 'SAM 2.1 Tiny (~32 MB · WebGPU)',
    repoId: 'onnx-community/sam2.1-hiera-tiny-ONNX',
    kind: 'sam',
    approxSize: '~32 MB',
    supportsClickPrompt: true,
    webgpuDtype: 'q4f16',
    wasmDtype: 'int8',
    description:
      'Meta SAM 2.1 Hiera-Tiny encoder + decoder for crisp pixel masks via Auto-Slice or Click-to-Segment.',
  },
  {
    id: 'sam3-tracker',
    label: 'SAM 3 Tracker (~287 MB · WebGPU)',
    repoId: 'onnx-community/sam3-tracker-ONNX',
    kind: 'sam',
    approxSize: '~287 MB',
    supportsClickPrompt: true,
    webgpuDtype: 'q4f16',
    wasmDtype: 'int8',
    description:
      'Meta SAM 3 Tracker backbone for highest-precision segmentation on dense tapestries and photos.',
  },
  {
    id: 'grounding-dino',
    label: 'Grounding DINO (Prompt · ~144 MB)',
    repoId: 'onnx-community/grounding-dino-tiny-ONNX',
    kind: 'zero-shot-det',
    approxSize: '~144 MB',
    supportsClickPrompt: false,
    webgpuDtype: 'q4f16',
    wasmDtype: 'int8',
    description:
      'Open-set text-prompted detector (e.g. "embroidery motif . flower . cottage . tree . emblem").',
  },
  {
    id: 'yolos-tiny',
    label: 'YOLOS Tiny (~26 MB · Fast Det)',
    repoId: 'Xenova/yolos-tiny',
    kind: 'object-det',
    approxSize: '~26 MB',
    supportsClickPrompt: false,
    webgpuDtype: 'q4f16',
    wasmDtype: 'quantized',
    description: 'Lightweight YOLO-style vision transformer detector for real objects in scenes and props.',
  },
  {
    id: 'ormbg',
    label: 'ORMBG Matte (~42 MB · BG Cutout)',
    repoId: 'onnx-community/ormbg-ONNX',
    kind: 'matting',
    approxSize: '~42 MB',
    supportsClickPrompt: false,
    webgpuDtype: 'fp16',
    wasmDtype: 'int8',
    description:
      'Deep foreground matting strips complex paper, linen, or photo backgrounds before slicing motifs.',
  },
];

export interface SegmentationStatus {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'error';
  modelId: SegmentationModelId | null;
  device: 'webgpu' | 'wasm' | 'cpu' | null;
  fraction: number;
  message: string;
}

export interface AutoSegmentResult {
  candidates: SegmentedMaskCandidate[];
  matteAlpha?: Uint8Array;
  device: 'webgpu' | 'wasm';
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (err: Error) => void;
}

class SegmentationClient {
  private worker: Worker | null = null;
  private status: SegmentationStatus = {
    status: 'idle',
    modelId: null,
    device: null,
    fraction: 0,
    message: 'Smart Contrast ready (0 MB) or pick an AI model',
  };
  private listeners = new Set<(s: SegmentationStatus) => void>();
  private pending = new Map<string, PendingRequest>();

  subscribeStatus(fn: (s: SegmentationStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  getStatus(): SegmentationStatus {
    return this.status;
  }

  private emitStatus(next: SegmentationStatus) {
    this.status = next;
    for (const fn of this.listeners) {
      fn(next);
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('../workers/segmentationWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent<any>) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'status') {
        this.emitStatus({
          status: msg.status,
          modelId: msg.modelId ?? this.status.modelId,
          device: msg.device ?? this.status.device,
          fraction: typeof msg.fraction === 'number' ? msg.fraction : this.status.fraction,
          message: String(msg.message || ''),
        });
        return;
      }
      if (msg.type === 'result' || msg.type === 'error') {
        const req = this.pending.get(msg.requestId);
        if (!req) return;
        this.pending.delete(msg.requestId);
        if (msg.type === 'error') {
          req.reject(new Error(msg.error || 'Segmentation worker error'));
        } else {
          req.resolve(msg.payload);
        }
      }
    };
    worker.onerror = (err) => {
      const message = err?.message || 'Segmentation worker crashed';
      this.emitStatus({
        status: 'error',
        modelId: this.status.modelId,
        device: this.status.device,
        fraction: 0,
        message,
      });
      for (const req of this.pending.values()) {
        req.reject(new Error(message));
      }
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  private callWorker<T>(command: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
    const worker = this.ensureWorker();
    const requestId = `seg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage({ ...command, requestId }, transfer);
    });
  }

  async loadModel(modelId: SegmentationModelId): Promise<{ device: 'webgpu' | 'wasm' }> {
    const preset = SEGMENTATION_MODEL_PRESETS.find((p) => p.id === modelId);
    if (!preset || preset.kind === 'heuristic') {
      this.emitStatus({
        status: 'ready',
        modelId: 'contrast-fast',
        device: 'cpu',
        fraction: 1,
        message: 'Smart Contrast Slicer ready',
      });
      return { device: 'wasm' };
    }
    return this.callWorker<{ device: 'webgpu' | 'wasm' }>({
      type: 'load',
      preset,
    });
  }

  async autoSegmentImage(
    modelId: SegmentationModelId,
    imgData: ImageData,
    options: {
      seeds?: Array<{ x: number; y: number; score: number }>;
      textPrompt?: string;
      scoreThreshold?: number;
      minSize?: number;
      mergeGap?: number;
    } = {},
  ): Promise<AutoSegmentResult> {
    const preset = SEGMENTATION_MODEL_PRESETS.find((p) => p.id === modelId);
    if (!preset || preset.kind === 'heuristic') {
      throw new Error('Smart Contrast runs synchronously without the neural worker.');
    }
    const copyRgba = new Uint8ClampedArray(imgData.data);
    return this.callWorker<AutoSegmentResult>(
      {
        type: 'auto_segment',
        preset,
        rgba: copyRgba.buffer,
        width: imgData.width,
        height: imgData.height,
        seeds: options.seeds ?? [],
        textPrompt: options.textPrompt ?? 'motif . pattern . ornament . house . tree . character',
        scoreThreshold: options.scoreThreshold ?? 0.2,
        minSize: options.minSize ?? 10,
        mergeGap: options.mergeGap ?? 6,
      },
      [copyRgba.buffer],
    );
  }

  async segmentPrompt(
    modelId: SegmentationModelId,
    imgData: ImageData,
    prompt: { point?: { x: number; y: number; positive?: boolean }; box?: CropSelection },
  ): Promise<SegmentedMaskCandidate | null> {
    const preset = SEGMENTATION_MODEL_PRESETS.find((p) => p.id === modelId);
    if (!preset || preset.kind !== 'sam') {
      throw new Error('Click/box interactive segmentation requires EdgeTAM, SAM 2.1, or SAM 3.');
    }
    const copyRgba = new Uint8ClampedArray(imgData.data);
    return this.callWorker<SegmentedMaskCandidate | null>(
      {
        type: 'segment_prompt',
        preset,
        rgba: copyRgba.buffer,
        width: imgData.width,
        height: imgData.height,
        point: prompt.point,
        box: prompt.box,
      },
      [copyRgba.buffer],
    );
  }

  async unload(): Promise<void> {
    if (!this.worker) return;
    await this.callWorker({ type: 'unload' }).catch(() => {});
    this.emitStatus({
      status: 'idle',
      modelId: null,
      device: null,
      fraction: 0,
      message: 'Unloaded vision segmentation model',
    });
  }
}

export const segmentationClient = new SegmentationClient();
