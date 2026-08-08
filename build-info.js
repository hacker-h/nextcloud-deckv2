import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));

// A container build has no git history, so CI passes BUILD_SHA in explicitly.
function buildSha() {
  const sha = process.env.BUILD_SHA;
  if (sha) return sha.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export const buildDefines = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __BUILD_SHA__: JSON.stringify(buildSha()),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
};
