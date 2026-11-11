export interface LocalApiProbeResult {
  ok: boolean;
  models: string[];
  error?: string;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function probeLocalApiModels(baseUrl: string): Promise<LocalApiProbeResult> {
  const clean = normalizeBaseUrl(baseUrl);
  try {
    const res = await fetch(`${clean}/models`);
    if (res.ok) {
      const data = await res.json();
      const ids = Array.isArray(data?.data)
        ? data.data.map((m: any) => String(m.id)).filter(Boolean)
        : [];
      return { ok: true, models: ids };
    }
  } catch {
    // Try Ollama native /api/tags if /v1 failed
  }

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

export async function chatWithLocalApi(params: {
  baseUrl: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  onChunk?: (chunk: string) => void;
}): Promise<{ text: string; durationMs: number }> {
  const clean = normalizeBaseUrl(params.baseUrl);
  const startedAt = performance.now();

  const res = await fetch(`${clean}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? 140,
      temperature: params.temperature ?? 0.5,
      stream: Boolean(params.onChunk),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Local API HTTP ${res.status}: ${errText.slice(0, 140)}`);
  }

  if (params.onChunk && res.body) {
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
            params.onChunk(delta);
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
  const content = json?.choices?.[0]?.message?.content ?? '';
  return {
    text: String(content).trim(),
    durationMs: Math.round(performance.now() - startedAt),
  };
}
