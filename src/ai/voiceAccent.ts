/**
 * The instruction for reading a line aloud. The template is used exactly as written, with
 * {locale} (the voice's speech locale; {accent} is the same), {world} (the world language)
 * and {gender} filled in. The default is the voice model's documented form: reading English
 * text "in Greek" gives it a Greek storytelling accent. Long or hedged instructions make the
 * model lose the line, so keep them to one sentence.
 */
export const TTS_TEMPLATE_DEFAULT = 'Perform TTS in {locale} using a {gender} voice.';

export function ttsInstruction(
  locale: string,
  worldLanguage: string | undefined,
  gender: string,
  template?: string,
): string {
  const world = worldLanguage?.trim() || 'English';
  return fillTtsTemplate(template?.trim() ? template : TTS_TEMPLATE_DEFAULT, { locale: locale.trim() || world, world, gender });
}

export function fillTtsTemplate(template: string, values: { locale: string; world: string; gender: string }): string {
  return template.replace(/\{(locale|accent|world|gender)\}/g, (_, k: string) =>
    k === 'world' ? values.world : k === 'gender' ? values.gender : values.locale,
  );
}
