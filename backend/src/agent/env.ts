import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Loads KEY=VALUE lines from the group's .env into process.env, without a
// dependency. Values already in the environment win.
export function loadEnv(file = join(__dirname, '..', '..', '..', '.env')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
