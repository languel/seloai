import type { Direction, VillageMap } from './types';

export interface GridPoint {
  x: number;
  y: number;
}

export function isTileWalkable(map: VillageMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  if (map.collisionGrid?.[x]?.[y]) return false;
  return true;
}

export function findNearestWalkableTile(map: VillageMap, startX: number, startY: number): GridPoint {
  const sx = Math.max(0, Math.min(map.width - 1, Math.round(startX)));
  const sy = Math.max(0, Math.min(map.height - 1, Math.round(startY)));
  if (isTileWalkable(map, sx, sy)) return { x: sx, y: sy };

  for (let radius = 1; radius < Math.max(map.width, map.height); radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const nx = sx + dx;
        const ny = sy + dy;
        if (isTileWalkable(map, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x: sx, y: sy };
}

export function computeFacing(from: GridPoint, to: GridPoint, fallback: Direction = 'down'): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'down' : 'up';
}

/**
 * Grid A* pathfinder returning tile coordinates excluding start and including goal.
 */
export function findPath(
  map: VillageMap,
  start: GridPoint,
  goal: GridPoint,
  blockedDynamic?: Set<string>,
  maxIterations = 1200,
): GridPoint[] {
  const sx = Math.round(start.x);
  const sy = Math.round(start.y);
  const gx = Math.round(goal.x);
  const gy = Math.round(goal.y);

  if (sx === gx && sy === gy) return [];
  if (!isTileWalkable(map, gx, gy)) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const startKey = key(sx, sy);
  const goalKey = key(gx, gy);

  const open: Array<{ x: number; y: number; k: string; f: number; g: number }> = [
    { x: sx, y: sy, k: startKey, f: Math.abs(gx - sx) + Math.abs(gy - sy), g: 0 },
  ];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();

  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  let iterations = 0;
  while (open.length > 0 && iterations < maxIterations) {
    iterations++;
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    if (current.k === goalKey) {
      const path: GridPoint[] = [];
      let curKey: string | undefined = goalKey;
      while (curKey && curKey !== startKey) {
        const [cx, cy] = curKey.split(',').map(Number);
        path.push({ x: cx, y: cy });
        curKey = cameFrom.get(curKey);
      }
      path.reverse();
      return path;
    }

    closed.add(current.k);

    for (const { dx, dy } of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      if (!isTileWalkable(map, nx, ny)) continue;
      if (nk !== goalKey && blockedDynamic?.has(nk)) continue;

      const tentativeG = current.g + 1;
      const prevG = gScore.get(nk);
      if (prevG === undefined || tentativeG < prevG) {
        cameFrom.set(nk, current.k);
        gScore.set(nk, tentativeG);
        const f = tentativeG + Math.abs(gx - nx) + Math.abs(gy - ny);
        const existing = open.find((n) => n.k === nk);
        if (existing) {
          existing.g = tentativeG;
          existing.f = f;
        } else {
          open.push({ x: nx, y: ny, k: nk, f, g: tentativeG });
        }
      }
    }
  }

  return [];
}
