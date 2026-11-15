import { describe, expect, it } from 'vitest';
import { isAllowedToolCallOrigin } from '../../api/webMcpBridge';
import { createDefaultMap, DEFAULT_MODEL_SETTINGS, DEFAULT_VILLAGERS } from '../../data/defaultData';
import { exportProjectJson, parseImportedVillageJson } from '../villageStore';

describe('Secrets and tool-call origins', () => {
  const settingsWithKeys = {
    ...DEFAULT_MODEL_SETTINGS,
    localApiKey: 'sk-local',
    voiceApiKey: 'sk-voice',
    imageGenApiKey: 'sk-image',
  };

  it('never writes API keys into a project export', () => {
    const json = exportProjectJson({
      map: createDefaultMap(),
      villagers: DEFAULT_VILLAGERS,
      modelSettings: settingsWithKeys,
      conversations: [],
      savedAt: 1,
    });
    expect(json).not.toContain('sk-local');
    expect(json).not.toContain('sk-voice');
    expect(json).not.toContain('sk-image');
    expect(JSON.parse(json).modelSettings.localApiModel).toBe(settingsWithKeys.localApiModel);
  });

  it('drops API keys found in an imported bundle', () => {
    const parsed = parseImportedVillageJson(
      JSON.stringify({ map: createDefaultMap(), modelSettings: settingsWithKeys }),
    );
    expect(parsed.modelSettings).toBeDefined();
    expect(parsed.modelSettings).not.toHaveProperty('localApiKey');
    expect(parsed.modelSettings).not.toHaveProperty('voiceApiKey');
    expect(parsed.modelSettings).not.toHaveProperty('imageGenApiKey');
  });

  it('accepts postMessage tool calls only from the page origin', () => {
    expect(isAllowedToolCallOrigin('https://app.example', 'https://app.example')).toBe(true);
    expect(isAllowedToolCallOrigin('https://evil.example', 'https://app.example')).toBe(false);
    expect(isAllowedToolCallOrigin('null', 'https://app.example')).toBe(false);
    expect(isAllowedToolCallOrigin('', 'https://app.example')).toBe(false);
  });
});
