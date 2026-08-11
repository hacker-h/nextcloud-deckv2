import { describe, expect, it } from 'vitest';
import {
  assertDeployableState,
  assertExpectedRevision,
  assertSuccessfulPublish,
  main,
  parseImageInspection,
  selectPublishRun,
} from './deploy-production.js';

const sha = '0123456789abcdef0123456789abcdef01234567';

describe('production deployment guardrails', () => {
  it('selects only a push run for the exact SHA and validates its result', () => {
    const expected = { headSha: sha, event: 'push', status: 'completed', conclusion: 'success', url: 'run-url' };
    const runs = [
      { ...expected, headSha: 'other' },
      { ...expected, event: 'pull_request' },
      { ...expected, event: 'pull_request', conclusion: 'failure' },
      expected,
    ];

    expect(selectPublishRun(runs, sha)).toBe(expected);
    expect(selectPublishRun(runs.slice(0, 3), sha)).toBeUndefined();
    expect(() => assertSuccessfulPublish(expected)).not.toThrow();
    expect(() => assertSuccessfulPublish({ ...expected, conclusion: 'failure' })).toThrow(/failure/);
  });

  it('refuses dirty, unpushed, and mismatched deployments', () => {
    expect(() => assertDeployableState({ status: ' M package.json', head: sha, originMain: sha })).toThrow(/dirty/);
    expect(() => assertDeployableState({ status: '', head: sha, originMain: 'other' })).toThrow(/origin\/main/);
    expect(() => assertDeployableState({ status: '', head: sha, originMain: sha })).not.toThrow();
    expect(() => assertExpectedRevision('other', sha)).toThrow(/mismatch/);
  });

  it('extracts the immutable digest and revision from remote inspection', () => {
    expect(parseImageInspection(`compose output\n${sha}|["ghcr.io/hacker-h/nextcloud-deckv2@sha256:abc"]`)).toEqual({
      revision: sha,
      digest: 'ghcr.io/hacker-h/nextcloud-deckv2@sha256:abc',
    });
    expect(() => parseImageInspection(`${sha}|[]`)).toThrow(/Incomplete/);
  });

  it('rejects shell metacharacters in remote deployment configuration', () => {
    expect(() => main(['--dry-run'], { DEPLOY_SERVICE: 'deckv2;reboot' })).toThrow(/Unsafe DEPLOY_SERVICE/);
  });
});
