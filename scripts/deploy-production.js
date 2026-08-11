import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  deployHost: 'alice',
  deployDir: '/home/alice/server-scripts/alice/deckv2',
  service: 'deckv2',
  prodUrl: 'https://deckv2.xhacker.de',
  workflow: 'docker-publish.yml',
};

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  process.stdout.write(`\n> ${printable}\n`);
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    ...options,
  });
}

function capture(command, args) {
  return String(run(command, args, { capture: true })).trim();
}

export function selectPublishRun(runs, sha) {
  return runs.find((run) => run.headSha === sha && run.event === 'push');
}

export function assertSuccessfulPublish(run) {
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`Publish run ${run.url} finished with ${run.status}/${run.conclusion || 'no conclusion'}.`);
  }
}

export function parseImageInspection(output) {
  const line = output.trim().split('\n').at(-1);
  const separator = line.indexOf('|');
  if (separator === -1) throw new Error(`Unexpected image inspection output: ${line}`);

  const revision = line.slice(0, separator);
  const digests = JSON.parse(line.slice(separator + 1));
  if (!revision || !Array.isArray(digests) || digests.length === 0) {
    throw new Error(`Incomplete image inspection output: ${line}`);
  }
  return { revision, digest: digests[0] };
}

export function assertDeployableState({ status, head, originMain }) {
  if (status) throw new Error('Refusing to deploy a dirty worktree. Commit or stash every change first.');
  if (head !== originMain) {
    throw new Error(`Refusing to deploy ${head}: origin/main is ${originMain}. Push the exact release commit first.`);
  }
}

export function assertExpectedRevision(actual, expected) {
  if (actual !== expected) {
    throw new Error(`Deployment revision mismatch: expected ${expected}, running ${actual}.`);
  }
}

function parseArgs(argv) {
  const unknown = argv.filter((arg) => arg !== '--dry-run');
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  return { dryRun: argv.includes('--dry-run') };
}

function assertSafeRemoteConfig(config) {
  const checks = [
    ['DEPLOY_HOST', config.deployHost, /^[A-Za-z0-9_.@-]+$/],
    ['DEPLOY_DIR', config.deployDir, /^\/[A-Za-z0-9_./-]+$/],
    ['DEPLOY_SERVICE', config.service, /^[A-Za-z0-9_.-]+$/],
  ];
  for (const [name, value, pattern] of checks) {
    if (!pattern.test(value)) throw new Error(`Unsafe ${name} value: ${value}`);
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { dryRun } = parseArgs(argv);
  const config = {
    deployHost: env.DEPLOY_HOST || DEFAULTS.deployHost,
    deployDir: env.DEPLOY_DIR || DEFAULTS.deployDir,
    service: env.DEPLOY_SERVICE || DEFAULTS.service,
    prodUrl: env.PROD_URL || DEFAULTS.prodUrl,
    workflow: env.GH_WORKFLOW || DEFAULTS.workflow,
  };
  assertSafeRemoteConfig(config);

  if (dryRun) {
    process.stdout.write(
      `Release plan: verify origin/main + successful ${config.workflow}; deploy ${config.service} on ${config.deployHost}; verify image revision/digest; smoke ${config.prodUrl}.\n`
    );
    return;
  }

  run('git', ['fetch', '--prune', 'origin', 'main']);
  const status = capture('git', ['status', '--porcelain=v1', '--untracked-files=all']);
  const head = capture('git', ['rev-parse', 'HEAD']);
  const originMain = capture('git', ['rev-parse', 'origin/main']);
  assertDeployableState({ status, head, originMain });

  const runs = JSON.parse(
    capture('gh', [
      'run', 'list', '--workflow', config.workflow, '--commit', head, '--event', 'push', '--limit', '10',
      '--json', 'databaseId,status,conclusion,headSha,event,url',
    ])
  );
  let publish = selectPublishRun(runs, head);
  if (!publish) {
    // GitHub may take a few seconds to register the run after a push. Keep the
    // release command single-shot instead of making the operator retry it.
    for (let attempt = 0; attempt < 24 && !publish; attempt += 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
      const retry = JSON.parse(
        capture('gh', [
          'run', 'list', '--workflow', config.workflow, '--commit', head, '--event', 'push', '--limit', '10',
          '--json', 'databaseId,status,conclusion,headSha,event,url',
        ])
      );
      publish = selectPublishRun(retry, head);
    }
  }
  if (!publish) throw new Error(`No push run of ${config.workflow} appeared for ${head} within two minutes.`);

  if (publish.status !== 'completed') {
    run('gh', ['run', 'watch', String(publish.databaseId), '--exit-status']);
    publish = {
      ...publish,
      ...JSON.parse(capture('gh', ['run', 'view', String(publish.databaseId), '--json', 'status,conclusion,url'])),
    };
  }
  assertSuccessfulPublish(publish);
  process.stdout.write(`Verified publish run: ${publish.url}\n`);

  const remoteCommand = [
    'set -euo pipefail',
    `cd ${config.deployDir}`,
    `docker compose pull ${config.service}`,
    `docker compose up -d --no-deps ${config.service}`,
    `container_id=$(docker compose ps -q ${config.service})`,
    'test -n "$container_id"',
    'image_id=$(docker inspect --format={{.Image}} "$container_id")',
    `docker image inspect --format='{{index .Config.Labels "org.opencontainers.image.revision"}}|{{json .RepoDigests}}' "$image_id"`,
  ].join(' && ');
  const inspection = parseImageInspection(capture('ssh', [config.deployHost, remoteCommand]));
  assertExpectedRevision(inspection.revision, head);
  process.stdout.write(`Verified running image: ${inspection.digest}\n`);

  run('npx', ['--no-install', 'playwright', 'test', '--project=prod-smoke'], {
    env: { ...env, PROD_URL: config.prodUrl, RELEASE_SHA: head },
  });
  process.stdout.write(`\nProduction release verified at ${head}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`\nRelease aborted: ${error.message}\n`);
    process.exitCode = 1;
  }
}
