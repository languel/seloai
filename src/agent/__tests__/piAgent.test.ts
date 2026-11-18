import { afterAll, describe, expect, it } from 'vitest';
import { startHeadlessHost } from '../../headless/headlessHost';
import { SELO_TOOL_DEFINITIONS, seloToolHost } from '../../api/seloToolRegistry';
import { PiAgent, piToolSpecs, toolResultText, type PiEvent } from '../piAgent';
import { buildPiApiRequest, readPiApiResponse, type PiMessage, type PiModel, type PiToolCall, type PiTurn } from '../piModel';

const host = startHeadlessHost({ tickMs: 100 });
afterAll(() => host.stop());

let n = 0;
const call = (name: string, args: Record<string, unknown>): PiToolCall => ({ id: `c${n++}`, type: 'function', function: { name, arguments: args } });

/** A stand-in for a model: plays a fixed script of turns, and records what it was shown. */
function scripted(turns: Array<PiToolCall[] | string>): PiModel & { seen: PiMessage[][] } {
  const seen: PiMessage[][] = [];
  let i = 0;
  return {
    label: 'script',
    seen,
    async complete(messages, _tools, opts): Promise<PiTurn> {
      seen.push(structuredClone(messages));
      const step = turns[i++] ?? 'Done.';
      if (typeof step === 'string') {
        opts.onText?.(step);
        return { message: { role: 'assistant', content: step }, finish: 'stop' };
      }
      return { message: { role: 'assistant', content: '', tool_calls: step }, finish: 'tool_calls' };
    },
  };
}

describe('Pi, the in-app agent', () => {
  it('builds a world through the tools, sees each result, and answers', async () => {
    const model = scripted([
      [call('story_overview', {})],
      [call('new_world', { kind: 'textile', name: 'Ashford', seed: 3 }), call('set_story', { place: 'Ashford', premise: 'The weaver has gone missing on the eve of the fair.', opening: 'The fair stalls stand half built.' })],
      [call('add_place', { name: 'The Loom House', near: 'the river' }), call('add_character', { name: 'Mira Thorn', role: 'Weaver', voice: 'female, Greek', home: 'The Loom House' })],
      'I made Ashford with the Loom House and Mira the weaver. Shall I add someone who wants the fair cancelled?',
    ]);
    const agent = new PiAgent({ model, tools: piToolSpecs(SELO_TOOL_DEFINITIONS, 'small'), runTool: (name, args) => seloToolHost.callTool(name, args) });
    const events: PiEvent[] = [];
    await agent.send('Make me a village about a missing weaver.', (e) => events.push(e));

    expect(events[0].type).toBe('agent_start');
    expect(events.at(-1)).toEqual({ type: 'agent_end', reason: 'done' });
    const ends = events.filter((e): e is Extract<PiEvent, { type: 'tool_execution_end' }> => e.type === 'tool_execution_end');
    expect(ends.map((e) => e.call.function.name)).toEqual(['story_overview', 'new_world', 'set_story', 'add_place', 'add_character']);
    expect(ends.every((e) => e.ok)).toBe(true);
    expect(ends.find((e) => e.call.function.name === 'add_character')!.label).toBe('add character: Mira Thorn');

    // The world really changed.
    expect(host.store.document.map.name).toBe('Ashford');
    expect(host.store.document.cast.some((c) => c.name === 'Mira Thorn' && c.voice?.language === 'Greek')).toBe(true);
    // Every tool result went back to the model, matched to its call.
    const last = model.seen.at(-1)!;
    const toolMsgs = last.filter((m): m is Extract<PiMessage, { role: 'tool' }> => m.role === 'tool');
    expect(toolMsgs).toHaveLength(5);
    const asked = last.filter((m) => m.role === 'assistant').flatMap((m) => ('tool_calls' in m ? m.tool_calls ?? [] : []));
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(asked.map((c) => c.id));
  });

  it('reports a failed tool to the model and refuses the same failing call twice', async () => {
    const bad = call('add_things', { thing: 'dragon' });
    const model = scripted([[bad], [{ ...bad, id: 'again' }], 'Sorry, I could not find that.']);
    const agent = new PiAgent({ model, tools: piToolSpecs(SELO_TOOL_DEFINITIONS, 'small'), runTool: (name, args) => seloToolHost.callTool(name, args) });
    const events: PiEvent[] = [];
    await agent.send('Add a dragon.', (e) => events.push(e));
    const ends = events.filter((e): e is Extract<PiEvent, { type: 'tool_execution_end' }> => e.type === 'tool_execution_end');
    expect(ends.map((e) => e.ok)).toEqual([false, false]);
    expect(ends[0].summary).toMatch(/Cannot place/);
    expect(ends[1].summary).toMatch(/already failed/);
  });

  it('stops at the round limit and when cancelled', async () => {
    const loop = scripted(Array.from({ length: 20 }, () => [call('story_overview', {})]));
    const agent = new PiAgent({ model: loop, tools: [], runTool: async () => ({}), maxRounds: 3 });
    const events: PiEvent[] = [];
    await agent.send('Go.', (e) => events.push(e));
    expect(events.at(-1)).toEqual({ type: 'agent_end', reason: 'max_rounds' });

    const controller = new AbortController();
    controller.abort();
    const ev2: PiEvent[] = [];
    await new PiAgent({ model: scripted(['hi']), tools: [], runTool: async () => ({}) }).send('Go.', (e) => ev2.push(e), controller.signal);
    expect(ev2.at(-1)).toEqual({ type: 'agent_end', reason: 'cancelled' });
  });

  it('keeps pictures out of what the model reads', () => {
    expect(toolResultText({ ok: true, image: 'data:image/jpeg;base64,AAAA' })).toBe('{"ok":true,"image":"[picture shown to the person]"}');
    expect(toolResultText({ text: 'x'.repeat(5000) }, 100)).toMatch(/cut/);
  });

  it('offers a small tool set to small models and more to strong ones', () => {
    const small = piToolSpecs(SELO_TOOL_DEFINITIONS, 'small').map((t) => t.function.name);
    const full = piToolSpecs(SELO_TOOL_DEFINITIONS, 'full').map((t) => t.function.name);
    expect(small.length).toBeLessThanOrEqual(19);
    expect(small).toEqual(expect.arrayContaining(['list_settings', 'change_setting', 'set_appearance']));
    expect(full.length).toBeGreaterThan(small.length);
    expect(full).toContain('write_story_markdown');
  });
});

describe('Pi over a cloud API', () => {
  const messages: PiMessage[] = [
    { role: 'system', content: 'Be Pi.' },
    { role: 'user', content: 'Add Ada.' },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'add_character', arguments: { name: 'Ada' } } }] },
    { role: 'tool', tool_call_id: 't1', name: 'add_character', content: '{"ok":true}' },
  ];
  const tools = piToolSpecs(SELO_TOOL_DEFINITIONS, 'small');

  it('speaks the OpenAI tool format, and reads tool calls back', () => {
    const req = buildPiApiRequest({ localApiProvider: 'openrouter', localApiUrl: 'https://openrouter.ai/api/v1/', localApiModel: 'some/model', localApiKey: 'k' }, messages, tools);
    expect(req.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer k');
    const sent = (req.body.messages as any[])[2];
    expect(sent.tool_calls[0].function.arguments).toBe('{"name":"Ada"}');
    const turn = readPiApiResponse('openai', {
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'x', function: { name: 'set_story', arguments: '{"place":"Ash"}' } }] } }],
    });
    expect(turn.finish).toBe('tool_calls');
    expect(turn.message.tool_calls![0].function.arguments).toEqual({ place: 'Ash' });
  });

  it('speaks the Anthropic tool format, and reads tool calls back', () => {
    const req = buildPiApiRequest({ localApiProvider: 'anthropic', localApiUrl: 'https://api.anthropic.com/v1', localApiModel: 'claude-x', localApiKey: 'k' }, messages, tools);
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers['x-api-key']).toBe('k');
    expect(req.body.system).toBe('Be Pi.');
    const body = req.body as { messages: any[]; tools: any[] };
    expect(body.messages[1].content[0]).toEqual({ type: 'tool_use', id: 't1', name: 'add_character', input: { name: 'Ada' } });
    expect(body.messages[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' });
    expect(body.tools[0].input_schema.type).toBe('object');
    const turn = readPiApiResponse('anthropic', { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Adding.' }, { type: 'tool_use', id: 'u', name: 'add_place', input: { name: 'Mill' } }] });
    expect(turn.message.content).toBe('Adding.');
    expect(turn.message.tool_calls![0].function).toEqual({ name: 'add_place', arguments: { name: 'Mill' } });
  });
});

describe('Pi always answers', () => {
  it('asks once for a word back when the model finishes silently after tools', async () => {
    const model = scripted([[call('story_overview', {})], '', 'I looked at the story.']);
    const agent = new PiAgent({ model, tools: [], runTool: async () => ({ ok: true }) });
    const events: PiEvent[] = [];
    await agent.send('Look.', (e) => events.push(e));
    const said = events.filter((e): e is Extract<PiEvent, { type: 'message_end' }> => e.type === 'message_end').map((e) => e.message.content);
    expect(said.at(-1)).toBe('I looked at the story.');
    // The silent turn is not kept; the nudge is.
    expect(agent.messages.some((m) => m.role === 'user' && /what you did/.test(m.content))).toBe(true);
    expect(agent.messages.filter((m) => m.role === 'assistant' && !('tool_calls' in m && m.tool_calls) && !m.content).length).toBe(0);
  });
});

describe('Pi never leaves the person with nothing', () => {
  it('says so when the model stays silent even after being asked, or runs out of room', async () => {
    const silent = new PiAgent({ model: scripted([[call('story_overview', {})], '', '']), tools: [], runTool: async () => ({}) });
    const a: PiEvent[] = [];
    await silent.send('Table please.', (e) => a.push(e));
    expect(a.at(-1)).toEqual({ type: 'agent_end', reason: 'silent' });

    const long: PiModel = { label: 'long', complete: async () => ({ message: { role: 'assistant', content: '' }, finish: 'length' }) };
    const b: PiEvent[] = [];
    await new PiAgent({ model: long, tools: [], runTool: async () => ({}) }).send('Everything!', (e) => b.push(e));
    expect(b.at(-1)).toEqual({ type: 'agent_end', reason: 'too_long' });
  });
});

describe('Pi shows what it is doing', () => {
  it('passes reading progress and thoughts through as activity, before the words', async () => {
    const model: PiModel = {
      label: 'thinker',
      async complete(_m, _t, opts) {
        opts.onActivity?.({ kind: 'reading', fraction: 0.5 });
        opts.onActivity?.({ kind: 'thinking', delta: 'The well is dry, so' });
        opts.onText?.('Hello.');
        return { message: { role: 'assistant', content: 'Hello.' }, finish: 'stop' };
      },
    };
    const events: PiEvent[] = [];
    await new PiAgent({ model, tools: [], runTool: async () => ({}) }).send('Hi', (e) => events.push(e));
    expect(events.map((e) => e.type)).toEqual(['agent_start', 'turn_start', 'activity', 'activity', 'message_update', 'message_end', 'agent_end']);
  });
});

describe('what a tool really did', () => {
  it('reads the changes, a look, and what was not done from the result', async () => {
    const { toolOutcome } = await import('../piAgent');
    expect(toolOutcome({ ok: false, changed: [{ setting: 'look', from: 'Festive', to: 'Night plate' }], notChanged: [{ setting: 'narrator_speed', reason: 'x' }] })).toEqual({
      done: 'look: Festive → Night plate',
      notDone: 'narrator speed not changed',
    });
    expect(toolOutcome({ ok: true, applied: ['vest: green'], couldNotShow: ['cloaks and coats'] })).toEqual({ done: 'vest: green', notDone: 'cannot show cloaks and coats' });
    expect(toolOutcome({ ok: true })).toEqual({});
  });
});
