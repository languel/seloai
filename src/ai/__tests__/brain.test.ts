import { describe, expect, it } from 'vitest';
import {
  API_BRAIN_PRESETS,
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_VILLAGERS,
  getEffectiveVoice,
  IMAGE_GEN_PRESETS,
  OMNI_SPEECH_LANGUAGES,
  VOICE_BACKEND_PRESETS,
  WEBGPU_BRAIN_PRESETS,
} from '../../data/defaultData';
import { parseDialogueAndNarration } from '../brainRouter';
import { buildChatRequestSpec, generateImageViaApi, registerAgentImageHandler } from '../localApiClient';
import { parseMentionTargets } from '../../engine/simulation';

describe('Brain routing and dialogue parsing', () => {
  it('provides effective Omni voice profiles and documented speech locales', () => {
    expect(OMNI_SPEECH_LANGUAGES).toContain('British English');
    expect(OMNI_SPEECH_LANGUAGES).toContain('Polish');
    const bram = DEFAULT_VILLAGERS.find((v) => v.id === 'stoyan')!;
    const v = getEffectiveVoice(bram);
    expect(v.gender).toBe('male');
    expect(v.pitchSemitones).toBeLessThan(0);

    const legacyFallback = getEffectiveVoice({ voice: undefined });
    expect(legacyFallback).toEqual({
      gender: 'female',
      language: 'American English',
      pitchSemitones: 0,
      speakingRate: 1.0,
      warmthDb: 0,
    });
  });

  it('sets LFM3-Omni all-in-one as first choice, keeps Bonsai-2 27B at the bottom, and includes webml-community WebGPU brain presets', () => {
    expect(WEBGPU_BRAIN_PRESETS[0].id).toBe('lfm3-omni-allinone');
    expect(WEBGPU_BRAIN_PRESETS[0].engine).toBe('lfm3-omni');
    expect(DEFAULT_MODEL_SETTINGS.brainEngine).toBe('lfm3-omni');

    const ids = WEBGPU_BRAIN_PRESETS.map((p) => p.id);
    expect(ids).toContain('lfm3-omni-allinone');
    expect(ids).toContain('lfm3-1.7b-local');
    expect(ids).toContain('qwen3.5-0.8b-text');
    expect(ids).toContain('ternary-bonsai-1.7b');
    expect(ids).toContain('bonsai-1.7b-q1');
    expect(ids).toContain('minicpm5-2b');
    expect(ids).toContain('gemma-4-e2b');
    const last = WEBGPU_BRAIN_PRESETS[WEBGPU_BRAIN_PRESETS.length - 1];
    expect(last.id).toBe('bonsai-2-27b');
    expect(last.engine).toBe('bonsai2-gguf');
    expect(last.modelId).toBe('prism-ml/Ternary-Bonsai-2-27B-gguf');
  });

  it('strips NPC self-name prefixes and separates stage narration for the Scribe', () => {
    const parsed = parseDialogueAndNarration(
      'Mara: *adjusts her shawl by the loom* "Good morning, neighbor!" [smiles warmly]',
      'Mara',
    );
    expect(parsed.spoken).toBe('"Good morning, neighbor!"');
    expect(parsed.spoken.toLowerCase().startsWith('mara:')).toBe(false);
    expect(parsed.narration).toEqual([
      'Adjusts her shawl by the loom',
      'Smiles warmly',
    ]);

    const quoted = parseDialogueAndNarration('**Bram**: "The gears are freshly oiled."', 'Bram');
    expect(quoted.spoken).toBe('The gears are freshly oiled.');
  });

  it('parses @Scribe, custom narratorName, and multi-target @mentions cleanly', () => {
    const targetsScribe = parseMentionTargets(
      '@Scribe describe the square',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsScribe.map((t) => t.id)).toEqual(['narrator']);

    const targetsCustomNarrator = parseMentionTargets(
      '@Chronicle what happens next?',
      DEFAULT_VILLAGERS,
      { ...DEFAULT_MODEL_SETTINGS, narratorName: 'Chronicle' },
    );
    expect(targetsCustomNarrator.map((t) => t.id)).toEqual(['narrator']);

    const targetsSingle = parseMentionTargets(
      'Hey @Stoyan how is the forge?',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsSingle.map((t) => t.id)).toEqual(['stoyan']);

    const targetsMulti = parseMentionTargets(
      '@Scribe @Tsveta @Stoyan discuss the festival',
      DEFAULT_VILLAGERS,
      DEFAULT_MODEL_SETTINGS,
    );
    expect(targetsMulti.map((t) => t.id)).toEqual(['narrator', 'tsveta', 'stoyan']);
  });

  it('separates <think> meta-reasoning from <thought> inner flow and spoken dialogue, with sound off by default', () => {
    expect(DEFAULT_MODEL_SETTINGS.eavesdropSpeech).toBe(true);
    expect(DEFAULT_MODEL_SETTINGS.eavesdropThoughts).toBe(false);
    expect(DEFAULT_MODEL_SETTINGS.showReasoning).toBe(false);
    expect(DEFAULT_MODEL_SETTINGS.speakReasoning).toBe(false);

    const parsed = parseDialogueAndNarration(
      '<think>I need to respond in character as Mara.</think><thought>Did Bram hide the brass key?</thought>*glances at the lantern* Mara: Who left the gate unlatched?',
      'Mara',
    );
    expect(parsed.reasoning).toEqual(['I need to respond in character as Mara.']);
    expect(parsed.thoughts).toEqual(['Did Bram hide the brass key?']);
    expect(parsed.narration).toEqual(['Glances at the lantern']);
    expect(parsed.spoken).toBe('Who left the gate unlatched?');
    expect(parsed.display).not.toContain('I need to respond in character');

    // Unclosed streaming <think> must never leak into story display
    const streaming = parseDialogueAndNarration('<think>I need to stay in character', 'Mara');
    expect(streaming.spoken).toBe('');
    expect(streaming.display).toBe('');
    expect(streaming.reasoning).toEqual(['I need to stay in character']);
  });

  it('supports Gemini, Claude, ChatGPT, GitHub, OpenRouter, Ollama, Voice, and Image Gen request configs', async () => {
    expect(API_BRAIN_PRESETS.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['ollama', 'lmstudio', 'gemini', 'anthropic', 'openai', 'github', 'openrouter']),
    );
    expect(VOICE_BACKEND_PRESETS.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['local-omni-webspeech', 'openai', 'gemini', 'openrouter', 'elevenlabs']),
    );
    expect(IMAGE_GEN_PRESETS.map((p) => p.provider)).toEqual(
      expect.arrayContaining(['agent', 'openrouter', 'openai', 'gemini', 'local-sd', 'comfyui']),
    );

    const msgs = [
      { role: 'system' as const, content: 'You are Mara.' },
      { role: 'user' as const, content: 'Hello!' },
    ];
    const claudeSpec = buildChatRequestSpec({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-latest',
      apiKey: 'sk-ant-test',
      messages: msgs,
    });
    expect(claudeSpec.url).toBe('https://api.anthropic.com/v1/messages');
    expect(claudeSpec.headers['x-api-key']).toBe('sk-ant-test');
    expect(claudeSpec.body.system).toBe('You are Mara.');

    const geminiSpec = buildChatRequestSpec({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      apiKey: 'AIza-test',
      messages: msgs,
    });
    expect(geminiSpec.url).toContain('/models/gemini-2.5-flash:generateContent?key=AIza-test');
    expect(geminiSpec.body.systemInstruction.parts[0].text).toBe('You are Mara.');

    const openrouterSpec = buildChatRequestSpec({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemini-2.5-flash',
      apiKey: 'sk-or-test',
      messages: msgs,
    });
    expect(openrouterSpec.headers.Authorization).toBe('Bearer sk-or-test');
    expect(openrouterSpec.headers['X-Title']).toBe('SeloAI');

    // Agent image generation callback
    registerAgentImageHandler(async () => 'data:image/png;base64,iVBORw0KGgo=');
    try {
      const img = await generateImageViaApi(
        { prompt: 'Stone watchtower tileset', kind: 'tileset' },
        { ...DEFAULT_MODEL_SETTINGS, imageGenEnabled: true, imageGenProvider: 'agent' },
      );
      expect(img.dataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(img.provider).toBe('agent');
    } finally {
      registerAgentImageHandler(null);
    }
  });
});
