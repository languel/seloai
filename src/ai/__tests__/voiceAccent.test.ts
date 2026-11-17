import { describe, expect, it } from 'vitest';
import { TTS_TEMPLATE_DEFAULT, ttsInstruction } from '../voiceAccent';

describe('ttsInstruction', () => {
  it('defaults to the documented form with the voice locale', () => {
    expect(TTS_TEMPLATE_DEFAULT).toBe('Perform TTS in {locale} using a {gender} voice.');
    expect(ttsInstruction('Greek', 'English', 'male')).toBe('Perform TTS in Greek using a male voice.');
  });
  it('uses an edited template exactly, filling locale, world and gender', () => {
    expect(ttsInstruction('Turkish', 'English', 'female', 'Perform TTS in {world} using a {gender} voice with a {locale} accent.')).toBe(
      'Perform TTS in English using a female voice with a Turkish accent.',
    );
    expect(ttsInstruction('Greek', 'native', 'male', 'Read with a {accent} lilt.')).toBe('Read with a Greek lilt.');
  });
  it('falls back to the default when the template is blank, and to the world language when no locale is set', () => {
    expect(ttsInstruction('', undefined, 'female', '  ')).toBe('Perform TTS in English using a female voice.');
  });
});
