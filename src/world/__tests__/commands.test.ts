import { describe, expect, it } from 'vitest';
import { BALKAN_TILES } from '../../engine/balkanTileset';
import { isTileInWangSet } from '../../engine/wangTiling';
import { WorldCommandError, applyCommand, type WorldCommand } from '../commands';
import type { WorldDocument } from '../document';
import { WORLD_PACKS } from '../packs';
import { WorldStore } from '../worldStore';

function freshDocument(): WorldDocument {
  const pack = WORLD_PACKS[0].build();
  return { map: pack.map, cast: pack.cast!, context: pack.context };
}

describe('World commands', () => {
  it('never modifies the document it is given and shares what it did not change', () => {
    const doc = freshDocument();
    const before = structuredClone(doc);
    const next = applyCommand(doc, { type: 'map.setTiles', layer: 'bg1', cells: [{ x: 2, y: 3, tile: 7 }] });
    expect(doc).toEqual(before);
    expect(next.map.bgTiles[1][2][3]).toBe(7);
    expect(next.map.bgTiles[0]).toBe(doc.map.bgTiles[0]);
    expect(next.cast).toBe(doc.cast);
  });

  it('paints, fills and flood-fills tiles within bounds', () => {
    let doc = freshDocument();
    doc = applyCommand(doc, { type: 'map.fillRect', layer: 'obj1', x: -2, y: 0, width: 4, height: 2, tile: 5 });
    expect(doc.map.objectTiles[1][0][0]).toBe(5);
    expect(doc.map.objectTiles[1][1][1]).toBe(5);
    expect(doc.map.objectTiles[1][2][0]).toBe(-1);

    doc = applyCommand(doc, { type: 'map.floodFill', layer: 'obj1', x: 0, y: 0, tile: 9 });
    expect(doc.map.objectTiles[1][1][1]).toBe(9);
    expect(doc.map.objectTiles[1][2][0]).toBe(-1);
  });

  it('auto-tiles a Wang set by its base tile', () => {
    const base = BALKAN_TILES.WANG_MEADOW_A_BASE;
    const doc = applyCommand(freshDocument(), {
      type: 'map.paintWang',
      kind: 'edge',
      layer: 'obj1',
      baseTileId: base,
      cells: [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ],
    });
    expect(isTileInWangSet(doc.map.objectTiles[1][5][5], base)).toBe(true);
    expect(isTileInWangSet(doc.map.objectTiles[1][6][5], base)).toBe(true);
    expect(doc.map.objectTiles[1][5][5]).not.toBe(doc.map.objectTiles[1][6][5]);
  });

  it('resizes the map and drops landmarks that fall outside it', () => {
    const doc = applyCommand(freshDocument(), { type: 'map.resize', width: 20, height: 18 });
    expect(doc.map.width).toBe(20);
    expect(doc.map.bgTiles[0].length).toBe(20);
    expect(doc.map.collisionGrid[19].length).toBe(18);
    expect((doc.map.pointsOfInterest ?? []).every((p) => p.x < 20 && p.y < 18)).toBe(true);
  });

  it('edits landmarks, stamps and the cast by id', () => {
    let doc = freshDocument();
    doc = applyCommand(doc, {
      type: 'map.upsertPoi',
      poi: { id: 'poi-test', tag: 'Test', label: 'Test Place', x: 4, y: 4 },
    });
    expect(doc.map.pointsOfInterest?.some((p) => p.id === 'poi-test')).toBe(true);
    doc = applyCommand(doc, { type: 'map.removePoi', id: 'poi-test' });
    expect(doc.map.pointsOfInterest?.some((p) => p.id === 'poi-test')).toBe(false);

    doc = applyCommand(doc, {
      type: 'map.upsertStamp',
      stamp: { id: 'stamp-a', name: 'A', width: 2, height: 1, tiles: [3, 4], layer: 'obj0', blocksMovement: true },
    });
    doc = applyCommand(doc, { type: 'map.placeStamp', stampId: 'stamp-a', x: 10, y: 10 });
    expect(doc.map.objectTiles[0][10][10]).toBe(3);
    expect(doc.map.objectTiles[0][11][10]).toBe(4);
    expect(doc.map.collisionGrid[10][10]).toBe(true);

    doc = applyCommand(doc, { type: 'cast.update', id: 'stoyan', patch: { role: 'Bridge Warden' } });
    expect(doc.cast.find((m) => m.id === 'stoyan')?.role).toBe('Bridge Warden');
    doc = applyCommand(doc, { type: 'cast.remove', id: 'stoyan' });
    expect(doc.cast.some((m) => m.id === 'stoyan')).toBe(false);

    doc = applyCommand(doc, { type: 'context.update', patch: { premise: 'The rains returned.' } });
    expect(doc.context.premise).toBe('The rains returned.');
    expect(doc.context.storyLines.characterLines.lamia).toBeDefined();
  });

  it('rejects invalid commands with a clear message', () => {
    const doc = freshDocument();
    const attempt = (command: unknown) => () => applyCommand(doc, command as WorldCommand);
    expect(attempt({ type: 'map.teleport' })).toThrow(WorldCommandError);
    expect(attempt({ type: 'map.setTiles', layer: 'sky', cells: [] })).toThrow(/Unknown layer/);
    expect(attempt({ type: 'map.placeStamp', stampId: 'missing', x: 0, y: 0 })).toThrow(/No stamp/);
    expect(attempt({ type: 'map.upsertPoi', poi: { id: 'p', tag: 'P', label: 'P', x: 999, y: 0 } })).toThrow(/outside/);
    expect(attempt({ type: 'cast.update', id: 'nobody', patch: {} })).toThrow(/No character/);
    expect(attempt({ type: 'cast.update', id: 'lamia', patch: { id: 'other' } })).toThrow(/cannot be changed/);
    expect(attempt({ type: 'map.resize', width: 2, height: 2 })).toThrow(/between/);
  });
});

describe('World store', () => {
  it('undoes and redoes commands and reports each change', () => {
    const store = new WorldStore();
    const reasons: string[] = [];
    store.subscribe((_doc, _previous, reason) => reasons.push(reason));
    store.reset(freshDocument());
    const original = store.document;

    store.dispatch({ type: 'map.rename', name: 'Renamed' }, 'Rename map');
    expect(store.document.map.name).toBe('Renamed');
    expect(store.history).toEqual(['Rename map']);

    expect(store.undo()).toBe('Rename map');
    expect(store.document).toBe(original);
    expect(store.canUndo).toBe(false);
    expect(store.redo()).toBe('Rename map');
    expect(store.document.map.name).toBe('Renamed');
    expect(reasons).toEqual(['reset', 'command', 'undo', 'redo']);
  });

  it('applies a batch as one step and applies none of it if any command is invalid', () => {
    const store = new WorldStore();
    store.reset(freshDocument());
    const original = store.document;

    expect(() =>
      store.dispatchAll([
        { type: 'map.rename', name: 'Half done' },
        { type: 'cast.remove', id: 'nobody' },
      ]),
    ).toThrow(WorldCommandError);
    expect(store.document).toBe(original);
    expect(store.canUndo).toBe(false);

    store.dispatchAll(
      [
        { type: 'map.rename', name: 'Two edits' },
        { type: 'cast.remove', id: 'tsveta' },
      ],
      'Batch',
    );
    expect(store.history).toEqual(['Batch']);
    store.undo();
    expect(store.document).toBe(original);
  });

  it('clears history when a different world is loaded', () => {
    const store = new WorldStore();
    store.reset(freshDocument());
    store.dispatch({ type: 'map.rename', name: 'X' });
    store.reset(freshDocument());
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
  });
});
