/**
 * .env serialization for `forge pull` (mirrors the API's export format).
 */

/** Parse a `KEY=value` CLI argument (split on the FIRST '='). */
/** Key-only args are allowed — the caller prompts for the value. */
export function parseSetArg(arg: string): { key: string; value: string } | null {
  const eq = arg.indexOf('=');
  if (eq === -1) {
    const key = arg.trim();
    return key ? { key, value: '' } : null; // key only — prompt for value
  }
  if (eq <= 0) return null; // empty key
  return { key: arg.slice(0, eq).trim(), value: arg.slice(eq + 1) };
}

/**
 * Merge secrets over the current environment for `forge run`.
 * Secrets win — that's the point of the vault.
 */
export function mergeEnv(base: NodeJS.ProcessEnv, secrets: Record<string, string>): NodeJS.ProcessEnv {
  return { ...base, ...secrets };
}

/** Serialize a values map as .env text (round-trip safe). */
export function formatEnvFile(values: Record<string, string>): string {
  const lines = Object.keys(values)
    .sort()
    .map((key) => {
      const value = values[key];
      if (/[\r\n]/.test(value) || value.startsWith('"') || value.startsWith("'")) {
        return `${key}=${JSON.stringify(value)}`;
      }
      return `${key}=${value}`;
    });
  return lines.length ? lines.join('\n') + '\n' : '';
}
