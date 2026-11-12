/**
 * Resolves a public-folder path (e.g. `/assets/...`, `/vendor/...`, `/models/...`)
 * against Vite's `import.meta.env.BASE_URL` so deployments work both at `/`
 * and on project subpaths such as GitHub Pages (`/<repo>/`).
 */
export function resolvePublicUrl(rawPath: string): string {
  if (!rawPath) return rawPath;
  if (/^(https?:|data:|blob:)/i.test(rawPath)) return rawPath;

  const baseEnv = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
  const base = baseEnv.endsWith('/') ? baseEnv : `${baseEnv}/`;
  const clean = rawPath.replace(/^\.\//, '');

  if (clean.startsWith('/')) {
    if (base !== '/' && clean.startsWith(base)) {
      return clean;
    }
    return `${base}${clean.slice(1)}`;
  }
  return `${base}${clean}`;
}

export function resolveOriginUrl(rawPath: string): string {
  const resolved = resolvePublicUrl(rawPath);
  if (/^(https?:|data:|blob:)/i.test(resolved)) return resolved;
  const origin =
    typeof globalThis.location !== 'undefined' && globalThis.location.origin !== 'null'
      ? globalThis.location.origin
      : 'http://localhost';
  return `${origin}${resolved.startsWith('/') ? resolved : `/${resolved}`}`;
}
