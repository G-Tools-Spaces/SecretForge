/**
 * Shared validation + .env parsing helpers for secrets.
 *
 * Key names are safe to store, display, and audit — only VALUES are sensitive.
 */

/** Standard environment-variable name (what `process.env` allows). */
export const SECRET_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SECRET_KEY_MAX = 255;

/** Environment names: lowercase slug (dev, staging, prod, or custom). */
export const ENV_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,29}$/;

export function isValidSecretKey(key: string): boolean {
  return key.length <= SECRET_KEY_MAX && SECRET_KEY_PATTERN.test(key);
}

export function isValidEnvName(name: string): boolean {
  return ENV_NAME_PATTERN.test(name);
}

/**
 * Strip one layer of quoting from a single-line value.
 *  - "double" → JSON semantics (escapes like \n, \t, \" are honored)
 *  - 'single' → literal, no escapes (shell behavior)
 *  - unmatched quote → value kept as-is
 */
function unquote(value: string): string {
  if (value.startsWith('"')) {
    if (value.length >= 2 && value.endsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return value.slice(1, -1);
      }
    }
    return value; // unmatched opening quote — keep raw
  }
  if (value.startsWith("'")) {
    if (value.length >= 2 && value.endsWith("'")) {
      return value.slice(1, -1);
    }
    return value;
  }
  return value;
}

/**
 * Parse `.env`-style content into a key→value map.
 *
 * Supported:
 *   KEY=value            (values may contain '=' — split on the FIRST '=')
 *   KEY="quoted value"   (double quotes: JSON-style escapes honored)
 *   KEY='single quoted'  (single quotes: literal)
 *   KEY="multi
 *   line value"          (quoted values may span lines — e.g. pasted PEM keys)
 *   export KEY=value     (export prefix stripped)
 *   # comment lines      (skipped)
 *
 * Deliberately NOT supported: inline trailing comments (a value may
 * legitimately contain " #").
 */
export function parseEnvContent(content: string): { keys: Record<string, string>; invalid: string[] } {
  const keys: Record<string, string> = {};
  const invalid: string[] = [];
  const lines = content.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    let line = lines[i].trim();

    if (!line || line.startsWith('#')) {
      i++;
      continue;
    }
    if (line.startsWith('export ') || line.startsWith('export\t')) {
      line = line.slice('export'.length).trim();
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      invalid.push(line.slice(0, 40));
      i++;
      continue;
    }

    const key = line.slice(0, eq).trim();
    if (!isValidSecretKey(key)) {
      invalid.push(key.slice(0, 40));
      i++;
      continue;
    }

    const value = line.slice(eq + 1).trim();
    const q = value[0] === '"' || value[0] === "'" ? value[0] : null;

    // Unterminated quote on this line → maybe a multi-line quoted value.
    if (q && !(value.length >= 2 && value.endsWith(q))) {
      // Look ahead for a line ending with the same quote char.
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        if (lines[j].trim().endsWith(q)) {
          closed = true;
          break;
        }
        j++;
      }

      if (closed) {
        const parts: string[] = [value.slice(1)]; // drop the opening quote
        for (let k = i + 1; k < j; k++) parts.push(lines[k]); // inner lines kept raw
        const last = lines[j].trim();
        parts.push(last.slice(0, -1)); // drop the closing quote
        keys[key] = parts.join('\n');
        i = j + 1;
        continue;
      }

      // No closing quote anywhere: keep the raw value (unmatched quote).
      keys[key] = value;
      i++;
      continue;
    }

    keys[key] = unquote(value);
    i++;
  }

  return { keys, invalid };
}

/**
 * Serialize a key→value map back into `.env` format.
 * Values that would break round-tripping (newlines, leading quotes) are
 * emitted as JSON strings so parseEnvContent restores them exactly.
 */
export function formatEnvContent(values: Record<string, string>): string {
  const lines = Object.entries(values).map(([key, value]) => {
    if (/[\r\n]/.test(value) || value.startsWith('"') || value.startsWith("'")) {
      return `${key}=${JSON.stringify(value)}`;
    }
    return `${key}=${value}`;
  });
  return lines.length ? lines.join('\n') + '\n' : '';
}
