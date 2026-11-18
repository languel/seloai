import { describe, expect, it } from 'vitest';
import { EAVESDROP_WHOLE_MAP_RADIUS } from '../../ai/audioPipeline';
import { DEFAULT_MODEL_SETTINGS } from '../../data/defaultData';
import type { ModelSettings } from '../../engine/types';
import { DEFAULT_AESTHETIC_SETTINGS, type AestheticSettings } from '../../utils/aestheticThemes';
import { runSettingsTool, type SettingsHost } from '../settingsTools';

function fakeHost() {
  const state = { model: { ...DEFAULT_MODEL_SETTINGS } as ModelSettings, style: { ...DEFAULT_AESTHETIC_SETTINGS } as AestheticSettings, theme: 'system' as 'system' | 'light' | 'dark' };
  const host: SettingsHost = {
    getModel: () => state.model,
    updateModel: (patch) => {
      state.model = { ...state.model, ...patch };
    },
    style: { get: () => state.style, update: (next) => (state.style = next), getTheme: () => state.theme, setTheme: (t) => (state.theme = t) },
  };
  return { state, host, call: (name: string, args: Record<string, unknown>) => runSettingsTool(name, args, host) };
}

describe('settings tools', () => {
  it('list every setting with its value and choices, by area, and never the keys or addresses', async () => {
    const { call } = fakeHost();
    const all = await call('list_settings', {});
    const flat = all.groups.flatMap((g: { settings: Array<{ setting: string }> }) => g.settings.map((s) => s.setting));
    expect(flat).toEqual(expect.arrayContaining(['look', 'speech_style', 'woven_hand', 'narrator_voice_warmth', 'hearing_range', 'characters_talk']));
    expect(flat.join(' ')).not.toMatch(/api|key|url|provider|model_id/i);
    const look = all.groups[0].settings.find((s: { setting: string }) => s.setting === 'look');
    expect(look.choices).toContain('Night plate');
    expect(look.value).toBe('Festive');
    const sound = await call('list_settings', { area: 'sound' });
    expect(sound.groups).toHaveLength(1);
    await expect(call('list_settings', { area: 'weather' })).rejects.toThrow(/Unknown area/);
  });

  it('changes the look from plain names, like "night view"', async () => {
    const { state, call } = fakeHost();
    const r = await call('change_setting', { setting: 'look', value: 'night view' });
    expect(r.changed[0]).toEqual({ setting: 'look', from: 'Festive', to: 'Night plate' });
    expect(state.style.worldLook).toBe('night');
    await call('change_setting', { setting: 'look', value: 'Red and black' });
    expect(state.style.worldLook).toBe('redBlack');
    await call('change_setting', { setting: 'look', value: 'blackwork' });
    expect(state.style.worldLook).toBe('blackwork');
    await expect(call('change_setting', { setting: 'look', value: 'neon' })).rejects.toThrow(/one of: "Line art"/);
  });

  it('changes several at once, clamps numbers, and reads on/off words', async () => {
    const { state, call } = fakeHost();
    const r = await call('change_settings', { changes: { speech_style: 'woven', woven_hand: 'Hand-sewn', character_size: 3, ornaments: 'off', app_theme: 'dark', bogus: 1 } });
    expect(state.style.speechStyle).toBe('woven');
    expect(state.style.wovenHand).toBe('ductus');
    expect(state.style.characterScale).toBe(1.35);
    expect(state.style.showDecorations).toBe(false);
    expect(state.theme).toBe('dark');
    expect(r.changed.find((c: { setting: string }) => c.setting === 'character_size').note).toMatch(/out of range/);
    expect(r.ok).toBe(false);
    expect(r.notChanged[0].setting).toBe('bogus');
    expect(r.warning).toMatch(/NOT CHANGED: bogus/);
  });

  it('changes the narrator, hearing and story settings in the model settings', async () => {
    const { state, call } = fakeHost();
    await call('change_settings', { changes: { narrator_voice_warmth: 4, narrator_voice_accent: 'Greek', narrator_name: 'The Chronicler', characters_talk: false, hearing_range: 'all', hear_thoughts: true } });
    expect(state.model.narratorVoice).toMatchObject({ warmthDb: 4, language: 'Greek' });
    expect(state.model.narratorVoice.pitchSemitones).toBe(DEFAULT_MODEL_SETTINGS.narratorVoice.pitchSemitones);
    expect(state.model.narratorName).toBe('The Chronicler');
    expect(state.model.autoConverse).toBe(false);
    expect(state.model.proximityRadiusTiles).toBe(EAVESDROP_WHOLE_MAP_RADIUS);
    expect(state.model.eavesdropThoughts).toBe(true);
    await call('change_setting', { setting: 'hearing_range', value: 9 });
    expect(state.model.proximityRadiusTiles).toBe(9);
    await call('change_setting', { setting: 'hearing_range', value: 'off' });
    expect(state.model.proximityRadiusTiles).toBe(0);
  });

  it('finds a setting by its words when the key is not exact', async () => {
    const { state, call } = fakeHost();
    await call('change_settings', { changes: { narrator_speed: 0.9, 'narrator warmth': 1, 'hear map': 'all' } }).catch(() => undefined);
    expect(state.model.narratorVoice.speakingRate).toBe(0.9);
    expect(state.model.narratorVoice.warmthDb).toBe(1);
    // "voice" alone could be several: it says which, and changes nothing.
    await expect(call('change_setting', { setting: 'narrator voice', value: 'x' })).rejects.toThrow(/could mean narrator_voice_/);
  });

  it('refuses what it should: unknown or secret settings, and style without an app', async () => {
    const { call } = fakeHost();
    await expect(call('change_setting', { setting: 'api key', value: 'sk-evil' })).rejects.toThrow(/No setting called/);
    await expect(call('change_setting', { setting: 'brain url', value: 'http://evil' })).rejects.toThrow(/No setting called/);
    const headless: SettingsHost = { getModel: () => ({ ...DEFAULT_MODEL_SETTINGS }), updateModel: () => {} };
    await expect(runSettingsTool('change_setting', { setting: 'look', value: 'night' }, headless)).rejects.toThrow(/open in a browser tab/);
    const sound = await runSettingsTool('change_setting', { setting: 'ambient_sound', value: false }, headless);
    expect(sound.ok).toBe(true);
  });
});
