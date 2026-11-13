/**
 * Files PrivGuard skips: generated bundles, dependencies, lockfiles and binary
 * assets. Reviewing them adds noise (e.g. a rebuilt dist/index.js) and no value.
 */
const DEFAULT_IGNORES: RegExp[] = [
  /(^|\/)(dist|build|out|node_modules|vendor|coverage|\.next)\//,
  /\.min\.(js|css)$/,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum)$/,
  /\.(map|snap|svg|png|jpe?g|gif|ico|webp|pdf|zip|woff2?|ttf|db)$/i,
];

/** Turns a simple glob ("docs/**", "*.md") into a regex. */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/** Builds a matcher from the defaults plus the comma/newline-separated `ignore-paths` input. */
export function makeIgnoreMatcher(extra: string): (path: string) => boolean {
  const custom = extra
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(globToRegex);
  const all = [...DEFAULT_IGNORES, ...custom];
  return (path: string) => all.some(re => re.test(path));
}
