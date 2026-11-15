import type {
  ApiBrainProvider,
  ImageGenProvider,
  ModelSettings,
  VoiceBackendProvider,
} from '../engine/types';

export interface LocalApiProbeResult {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface ChatTurnMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function buildAuthHeaders(provider: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const key = apiKey?.trim();
  if (provider === 'anthropic') {
    if (key) headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return headers;
  }
  if (key && provider !== 'gemini') {
    headers.Authorization = `Bearer ${key}`;
  }
  if (provider === 'openrouter') {
    if (typeof globalThis.location !== 'undefined') {
      headers['HTTP-Referer'] = globalThis.location.origin;
    }
    headers['X-Title'] = 'SeloAI';
  }
  return headers;
}

export async function probeApiModels(
  baseUrl: string,
  provider: ApiBrainProvider = 'ollama',
  apiKey?: string,
): Promise<LocalApiProbeResult> {
  const clean = normalizeBaseUrl(baseUrl);
  const key = apiKey?.trim();

  if (provider === 'gemini') {
    if (!key) {
      return {
        ok: true,
        models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
      };
    }
    try {
      const res = await fetch(`${clean}/models?key=${encodeURIComponent(key)}`);
      if (res.ok) {
        const data = await res.json();
        const ids = Array.isArray(data?.models)
          ? data.models
              .map((m: any) => String(m.name || '').replace(/^models\//, ''))
              .filter(Boolean)
          : [];
        return { ok: true, models: ids };
      }
      return { ok: false, models: [], error: `Gemini HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, models: [], error: err?.message || 'Gemini unreachable' };
    }
  }

  if (provider === 'anthropic') {
    const known = [
      'claude-3-5-sonnet-latest',
      'claude-3-5-haiku-latest',
      'claude-3-7-sonnet-latest',
      'claude-sonnet-4-0',
    ];
    if (!key) return { ok: true, models: known };
    try {
      const res = await fetch(`${clean}/models`, {
        headers: buildAuthHeaders('anthropic', key),
      });
      if (res.ok) {
        const data = await res.json();
        const ids = Array.isArray(data?.data)
          ? data.data.map((m: any) => String(m.id)).filter(Boolean)
          : [];
        return { ok: true, models: ids.length ? ids : known };
      }
    } catch {
      // Fallback to curated list when CORS/models endpoint is restricted
    }
    return { ok: true, models: known };
  }

  try {
    const res = await fetch(`${clean}/models`, {
      headers: key ? buildAuthHeaders(provider, key) : undefined,
    });
    if (res.ok) {
      const data = await res.json();
      const ids = Array.isArray(data?.data)
        ? data.data.map((m: any) => String(m.id)).filter(Boolean)
        : [];
      if (ids.length > 0 || provider !== 'ollama') {
        return { ok: true, models: ids };
      }
    }
  } catch {
    // Fall through to Ollama native /api/tags
  }

  if (provider === 'ollama' || provider === 'custom') {
    try {
      const root = clean.replace(/\/v1$/, '');
      const res = await fetch(`${root}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const ids = Array.isArray(data?.models)
          ? data.models.map((m: any) => String(m.name)).filter(Boolean)
          : [];
        return { ok: true, models: ids };
      }
      return { ok: false, models: [], error: `HTTP ${res.status} from ${clean}` };
    } catch (err: any) {
      return {
        ok: false,
        models: [],
        error: `Cannot reach ${clean} (${err?.message || 'CORS or server offline'})`,
      };
    }
  }

  return { ok: false, models: [], error: `Unable to list models from ${clean}` };
}

/**
 * Pure request builder exposed for deterministic unit testing and inspection
 * across OpenAI/ChatGPT, GitHub Models, OpenRouter, Ollama, LM Studio, Claude, and Gemini.
 */
export function buildChatRequestSpec(params: {
  provider?: ApiBrainProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  messages: ChatTurnMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}): {
  url: string;
  headers: Record<string, string>;
  body: Record<string, any>;
} {
  const provider = params.provider ?? 'custom';
  const clean = normalizeBaseUrl(params.baseUrl);
  const headers = buildAuthHeaders(provider, params.apiKey);

  if (provider === 'anthropic') {
    const systemText = params.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const chatOnly = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      }));
    return {
      url: `${clean}/messages`,
      headers,
      body: {
        model: params.model,
        max_tokens: params.maxTokens ?? 160,
        temperature: params.temperature ?? 0.5,
        ...(systemText ? { system: systemText } : {}),
        messages: chatOnly.length > 0 ? chatOnly : [{ role: 'user', content: 'Continue.' }],
      },
    };
  }

  if (provider === 'gemini') {
    const systemText = params.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const modelId = params.model.replace(/^models\//, '');
    const keyQuery = params.apiKey?.trim() ? `?key=${encodeURIComponent(params.apiKey.trim())}` : '';
    return {
      url: `${clean}/models/${encodeURIComponent(modelId)}:generateContent${keyQuery}`,
      headers,
      body: {
        ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
        contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: 'Continue.' }] }],
        generationConfig: {
          maxOutputTokens: params.maxTokens ?? 160,
          temperature: params.temperature ?? 0.5,
        },
      },
    };
  }

  const endpoint = clean.endsWith('/chat/completions') ? clean : `${clean}/chat/completions`;
  return {
    url: endpoint,
    headers,
    body: {
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? 160,
      temperature: params.temperature ?? 0.5,
      stream: Boolean(params.stream),
    },
  };
}

export async function chatWithExternalApi(params: {
  provider?: ApiBrainProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  messages: ChatTurnMessage[];
  maxTokens?: number;
  temperature?: number;
  onChunk?: (chunk: string) => void;
}): Promise<{ text: string; durationMs: number }> {
  const provider = params.provider ?? 'custom';
  const startedAt = performance.now();
  const canStream =
    Boolean(params.onChunk) && provider !== 'anthropic' && provider !== 'gemini';
  const spec = buildChatRequestSpec({
    ...params,
    provider,
    stream: canStream,
  });

  const res = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify(spec.body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`${provider.toUpperCase()} API HTTP ${res.status}: ${errText.slice(0, 160)}`);
  }

  if (canStream && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            fullText += delta;
            params.onChunk?.(delta);
          }
        } catch {
          // ignore malformed SSE fragment
        }
      }
    }

    return {
      text: fullText.trim(),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const json = await res.json();
  let content = '';
  if (provider === 'anthropic') {
    content = Array.isArray(json?.content)
      ? json.content
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => b.text)
          .join('')
      : '';
  } else if (provider === 'gemini') {
    const parts = json?.candidates?.[0]?.content?.parts;
    content = Array.isArray(parts)
      ? parts.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('')
      : '';
  } else {
    content = json?.choices?.[0]?.message?.content ?? '';
  }

  const clean = String(content).trim();
  if (params.onChunk && clean) params.onChunk(clean);
  return {
    text: clean,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export async function synthesizeSpeechViaApi(params: {
  provider: VoiceBackendProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  text: string;
  gender?: 'female' | 'male' | 'neutral';
}): Promise<{ audioBuffer: ArrayBuffer; mimeType: string; durationMs: number }> {
  const startedAt = performance.now();
  const clean = normalizeBaseUrl(params.baseUrl);
  const key = params.apiKey?.trim();
  const voiceName = params.gender === 'male' ? 'onyx' : params.gender === 'neutral' ? 'alloy' : 'nova';

  if (params.provider === 'elevenlabs') {
    const voiceId = '21m00Tcm4TlvDq8ikWAM';
    const res = await fetch(`${clean}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'xi-api-key': key } : {}),
      },
      body: JSON.stringify({
        text: params.text,
        model_id: params.model || 'eleven_flash_v2_5',
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
    return {
      audioBuffer: await res.arrayBuffer(),
      mimeType: res.headers.get('content-type') || 'audio/mpeg',
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (params.provider === 'gemini') {
    const modelId = (params.model || 'gemini-2.5-flash-preview-tts').replace(/^models\//, '');
    const res = await fetch(
      `${clean}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key || '')}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: params.text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: params.gender === 'male' ? 'Charon' : 'Aoede',
                },
              },
            },
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}`);
    const json = await res.json();
    const inline = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
    if (!inline?.data) throw new Error('Gemini returned no audio payload');
    const binary = atob(inline.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return {
      audioBuffer: bytes.buffer,
      mimeType: inline.mimeType || 'audio/wav',
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  // OpenAI / OpenRouter / Custom OpenAI-compatible /audio/speech
  const res = await fetch(`${clean}/audio/speech`, {
    method: 'POST',
    headers: buildAuthHeaders(params.provider, key),
    body: JSON.stringify({
      model: params.model || 'tts-1',
      input: params.text,
      voice: voiceName,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`TTS API HTTP ${res.status}: ${errText.slice(0, 120)}`);
  }
  return {
    audioBuffer: await res.arrayBuffer(),
    mimeType: res.headers.get('content-type') || 'audio/mpeg',
    durationMs: Math.round(performance.now() - startedAt),
  };
}

export interface AgentImageHandler {
  (req: { prompt: string; kind: string; width: number; height: number }): Promise<string>;
}

let registeredAgentImageHandler: AgentImageHandler | null = null;

export function registerAgentImageHandler(fn: AgentImageHandler | null) {
  registeredAgentImageHandler = fn;
}

export async function generateImageViaApi(
  params: {
    prompt: string;
    kind?: 'tileset' | 'spritesheet' | 'portrait' | 'scene';
    width?: number;
    height?: number;
    agentProvidedDataUrl?: string;
  },
  settings: ModelSettings,
): Promise<{ dataUrl: string; provider: ImageGenProvider; durationMs: number }> {
  const startedAt = performance.now();
  if (params.agentProvidedDataUrl?.startsWith('data:image/')) {
    return {
      dataUrl: params.agentProvidedDataUrl,
      provider: 'agent',
      durationMs: 0,
    };
  }
  if (!settings.imageGenEnabled) {
    throw new Error('Image generation is disabled. Enable it in AI & Voice Monitor first.');
  }
  const provider = settings.imageGenProvider ?? 'agent';
  const clean = normalizeBaseUrl(settings.imageGenUrl || '');
  const key = settings.imageGenApiKey?.trim();
  const model = settings.imageGenModel?.trim() || 'gpt-image-1';
  const width = params.width ?? 512;
  const height = params.height ?? 512;

  if (provider === 'agent') {
    if (registeredAgentImageHandler) {
      const dataUrl = await registeredAgentImageHandler({
        prompt: params.prompt,
        kind: params.kind ?? 'scene',
        width,
        height,
      });
      return { dataUrl, provider: 'agent', durationMs: Math.round(performance.now() - startedAt) };
    }
    throw new Error(
      'Image provider is set to "agent": supply agentProvidedDataUrl or register an image handler via window.seloAI.',
    );
  }

  if (provider === 'openrouter') {
    const res = await fetch(`${clean}/chat/completions`, {
      method: 'POST',
      headers: buildAuthHeaders('openrouter', key),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: params.prompt }],
        modalities: ['image', 'text'],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter Image HTTP ${res.status}`);
    const json = await res.json();
    const imgUrl =
      json?.choices?.[0]?.message?.images?.[0]?.image_url?.url ||
      json?.choices?.[0]?.message?.images?.[0]?.url;
    if (!imgUrl) throw new Error('OpenRouter returned no generated image URL.');
    return {
      dataUrl: imgUrl,
      provider,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (provider === 'gemini') {
    const modelId = model.replace(/^models\//, '');
    const res = await fetch(
      `${clean}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(key || '')}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: params.prompt }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini Image HTTP ${res.status}`);
    const json = await res.json();
    const inline = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
    if (!inline?.data) throw new Error('Gemini returned no image data.');
    return {
      dataUrl: `data:${inline.mimeType || 'image/png'};base64,${inline.data}`,
      provider,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (provider === 'local-sd') {
    const res = await fetch(`${clean}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: params.prompt, width, height, steps: 20 }),
    });
    if (!res.ok) throw new Error(`Local SD HTTP ${res.status}`);
    const json = await res.json();
    const b64 = json?.images?.[0];
    if (!b64) throw new Error('Local SD returned no image.');
    return {
      dataUrl: b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`,
      provider,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  if (provider === 'comfyui') {
    throw new Error(
      `Local ComfyUI (${clean}) requires workflow queuing via the agent MCP bridge or an OpenAI-compatible image wrapper.`,
    );
  }

  // OpenAI / Custom OpenAI /images/generations
  const res = await fetch(`${clean}/images/generations`, {
    method: 'POST',
    headers: buildAuthHeaders(provider, key),
    body: JSON.stringify({
      model,
      prompt: params.prompt,
      size: `${width}x${height}`,
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) throw new Error(`Images API HTTP ${res.status}`);
  const json = await res.json();
  const item = json?.data?.[0];
  const dataUrl = item?.b64_json
    ? `data:image/png;base64,${item.b64_json}`
    : item?.url;
  if (!dataUrl) throw new Error('Images API returned no image payload.');
  return {
    dataUrl,
    provider,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
