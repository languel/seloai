import { describe, expect, it } from 'vitest';
import { storyPackFromMarkdown, storyToMarkdown } from '../storyText';
import { parseImportedFile } from '../../storage/villageStore';
import { validateWorldPack } from '../worldPack';

const SAMPLE = `---
title: The Dark Lamp
place: Gullrock
kind: harbour town
premise: The lighthouse lamp went dark last night and a ship is due at dawn.
opening: Open at dusk on the quay, the lamp cold.
focus: Ada
---

# Characters

## Ada Bell
- role: Lighthouse keeper
- wants: Find out who broke the lamp before dawn.
- speaks: Low and salty.
- voice: female, Danish, -0.5
- look: skirted

Stubborn and kind, she has kept the #Lighthouse for thirty years.

Says:
- "{partner}, the lamp did not break itself."

## Tobin Reed
- role: Net mender
- wants: Keep everyone talking about anything but the lamp.
- voice: male, Italian
- look: trousered

# Story lines

## Opening
- Fog rolls in as {a} and {b} meet by {place}.

## Anyone
- Did you hear a ship's bell? (when: ship, bell)
`;

describe('Markdown stories', () => {
  it('reads the header, the characters and the story lines', () => {
    const pack = storyPackFromMarkdown(SAMPLE);
    expect(validateWorldPack({ ...pack, map: { bgTiles: [[]], width: 1, collisionGrid: [[]] } }).filter((p) => !p.startsWith('map'))).toEqual([]);
    expect(pack.context).toMatchObject({ settingName: 'Gullrock', settingKind: 'harbour town', premise: expect.stringMatching(/lamp/), opening: expect.stringMatching(/dusk/) });
    expect(pack.cast?.map((c) => [c.id, c.name, c.role])).toEqual([
      ['ada', 'Ada Bell', 'Lighthouse keeper'],
      ['tobin', 'Tobin Reed', 'Net mender'],
    ]);
    const ada = pack.cast![0];
    expect(ada.identity).toMatch(/#Lighthouse/);
    expect(ada.voice).toMatchObject({ gender: 'female', language: 'Danish', pitchSemitones: -0.5 });
    expect(ada.figure).toEqual({ build: 'skirted' });
    expect(pack.context.storyLines.characterLines.ada.lines).toEqual(['{partner}, the lamp did not break itself.']);
    expect(pack.context.storyLines.openingBeats).toHaveLength(1);
    expect(pack.context.storyLines.sharedLines[0]).toEqual({ lines: ["Did you hear a ship's bell?"], whenMentioned: ['ship', 'bell'] });
    expect(pack.story.focalCharacterId).toBe('ada');
  });

  it('imports by file name, and survives a round trip through export', () => {
    const parsed = parseImportedFile('lamp.story.md', SAMPLE);
    expect(parsed.villagers).toHaveLength(2);
    const md = storyToMarkdown(parsed.world!, parsed.villagers!, 'The Dark Lamp', 'ada');
    const again = storyPackFromMarkdown(md);
    expect(again.cast?.map((c) => c.id)).toEqual(['ada', 'tobin']);
    expect(again.context.premise).toBe(parsed.world!.premise);
    expect(again.context.storyLines.characterLines.ada.lines).toEqual(parsed.world!.storyLines.characterLines.ada.lines);
    expect(again.context.storyLines.sharedLines).toEqual(parsed.world!.storyLines.sharedLines);
  });
});
