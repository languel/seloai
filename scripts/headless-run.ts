/**
 * Runs a world with no browser and prints its transcript.
 *   pnpm sim:headless -- --seed 7 --seconds 120 [--world <pack id>] [--out run.json]
 */
import fs from 'node:fs';
import { runHeadless } from '../src/headless/runHeadless';
import { DEFAULT_WORLD_PACK_ID, WORLD_PACKS, findWorldPack } from '../src/world/packs';

function readArg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const seed = Number(readArg('seed', '1'));
const simSeconds = Number(readArg('seconds', '120'));
const worldId = readArg('world', DEFAULT_WORLD_PACK_ID);
const outPath = readArg('out', '');

const definition = findWorldPack(worldId);
if (!definition) {
  console.error(`Unknown world "${worldId}". Available: ${WORLD_PACKS.map((p) => p.id).join(', ')}`);
  process.exit(1);
}
const pack = definition.build();
// A pack that is a place only borrows the default pack's cast.
const cast = pack.cast ?? findWorldPack(DEFAULT_WORLD_PACK_ID)!.build().cast ?? [];
const world = { map: pack.map, villagers: cast };

const startedAt = performance.now();
const result = await runHeadless({
  seed,
  simSeconds,
  map: world.map,
  villagers: world.villagers,
  world: pack.context,
});
const wallMs = Math.round(performance.now() - startedAt);

const names = new Map(world.villagers.map((v) => [v.id, v.name]));
for (const ev of result.trace) {
  const who = ev.senderId === 'narrator' ? 'Scribe' : (names.get(ev.senderId) ?? ev.senderId);
  const stamp = (ev.t / 1000).toFixed(1).padStart(6);
  console.log(`${stamp}s  [${ev.kind}] ${who}: ${ev.text}`);
}
console.log(
  `\nworld=${world.map.name} seed=${seed} simulated=${simSeconds}s ticks=${result.ticks} ` +
    `events=${result.trace.length} digest=${result.digest} wall=${wallMs}ms`,
);
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ${outPath}`);
}
