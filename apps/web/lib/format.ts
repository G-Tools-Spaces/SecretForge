/** Display helpers shared across pages. */

const ENV_LABELS: Record<string, string> = {
  dev: 'Development',
  staging: 'Staging',
  prod: 'Production',
};

/** "dev" → "Development", "prod" → "Production", custom names capitalized. */
export function envLabel(name: string): string {
  return ENV_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}
