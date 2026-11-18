/**
 * Pi against a real model, end to end: only when PI_LIVE_MODEL is set, e.g.
 *
 *   PI_LIVE_MODEL=qwen3:8b PI_LIVE_URL=http://localhost:11434/v1 pnpm exec vitest run src/agent/__tests__/piLive.test.ts
 *
 * It points Pi at that OpenAI-compatible endpoint, asks for a small world, and checks that
 * the world was really built through the tools. It prints what Pi did.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { startHeadlessHost } from '../../headless/headlessHost';
import { SELO_TOOL_DEFINITIONS, seloToolHost } from '../../api/seloToolRegistry';
import { DEFAULT_MODEL_SETTINGS } from '../../data/defaultData';
import { PiAgent, piToolSpecs, type PiEvent } from '../piAgent';
import { apiPiModel } from '../piModel';

const MODEL = process.env.PI_LIVE_MODEL;
const URL = process.env.PI_LIVE_URL ?? 'http://localhost:11434/v1';
const TOOLSET = (process.env.PI_LIVE_TOOLS as 'small' | 'full') ?? 'small';

describe.skipIf(!MODEL)('Pi with a live model', () => {
  const host = startHeadlessHost({ tickMs: 100 });
  afterAll(() => host.stop());

  it('makes a small world with the person', async () => {
    const settings = { ...DEFAULT_MODEL_SETTINGS, localApiProvider: 'ollama' as const, localApiUrl: URL, localApiModel: MODEL!, localApiKey: '' };
    const agent = new PiAgent({ model: apiPiModel(() => settings), tools: piToolSpecs(SELO_TOOL_DEFINITIONS, TOOLSET), runTool: (n, a) => seloToolHost.callTool(n, a) });
    const log: string[] = [];
    const onEvent = (e: PiEvent) => {
      if (e.type === 'tool_execution_end') log.push(`  ${e.ok ? 'ok ' : 'ERR'} ${e.label}${e.ok ? '' : ` -> ${e.summary.slice(0, 120)}`}`);
      if (e.type === 'message_end' && e.message.content.trim()) log.push(`Pi: ${e.message.content.trim().slice(0, 400)}`);
      if (e.type === 'agent_end') log.push(`[${e.reason}${e.error ? `: ${e.error}` : ''}]`);
    };
    const say = async (text: string) => {
      log.push(`You: ${text}`);
      const t0 = Date.now();
      await agent.send(text, onEvent);
      log.push(`  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    };
    await say('Make a new world with me: a small fishing village where the tide has stopped coming in. Build the place and its story now, with two places and three characters whose wants clash, then start the story. Do not ask me questions first.');
    console.log(log.join('\n'));
    const doc = host.store.document;
    console.log('World:', doc.map.name, '| premise:', doc.context.premise, '| places:', (doc.map.pointsOfInterest ?? []).map((p) => p.label).join(', '), '| cast:', doc.cast.map((c) => `${c.name} (${c.role})`).join(', '));
    expect(doc.cast.length).toBeGreaterThanOrEqual(2);
    expect((doc.map.pointsOfInterest ?? []).length).toBeGreaterThanOrEqual(1);
    expect(doc.context.premise.length).toBeGreaterThan(10);
  }, 600_000);
});
