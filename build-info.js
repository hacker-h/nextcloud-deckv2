import { execSync } from 'node:child_process';

// A container build has no git history, so CI passes BUILD_SHA in explicitly.
function buildSha() {
  if (process.env.BUILD_SHA) return process.env.BUILD_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export const buildDefines = {
  __BUILD_SHA__: JSON.stringify(buildSha()),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
};
