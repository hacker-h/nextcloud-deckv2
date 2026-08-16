# Repository Instructions

Read and follow `/Users/hacker/src/github.com/hacker-h/agent-scripts/AGENTS.MD`.

## Delivery policy

Every change is committed, pushed, and released. A change that only exists in
the working tree is not done. Do not stop at "implemented and tested" and wait
to be asked for the rest — carry it through to a published release.

### Always, for every change

1. **Commit.** Conventional Commits. Stage explicit paths; never `commit -a`,
   which sweeps up unrelated working-tree noise.
2. **Push to both remotes.** `github` and `gitlab` both track `main`; a push to
   only one leaves them divergent.
3. **Release** when the change is user-visible or changes behaviour: bump
   `package.json`, tag `vX.Y.Z`, push the tag to both remotes.

### Forward fix only

Never `revert`, `reset --hard`, force-push, or amend a pushed commit. A mistake
that is already pushed is fixed by a new commit on top, and a broken release is
fixed by a higher version — never by moving or deleting a tag. Published image
tags are immutable and something may already be running them.

### Versioning

Semver against the previous tag, judged by user impact:

- **patch** — bug fix, docs, internal refactor, test-only change
- **minor** — new capability, new endpoint, new config, additive schema
- **major** — removal, renamed or repurposed endpoint, breaking config change

`package.json` and the latest tag have drifted historically. The tag is the
release identity, so pick the next version from `git tag --sort=-v:refname`, not
from `package.json`, and set `package.json` to match in the release commit.

### Release sequence

```sh
npm run check && npm test && npm run test:audit && npm run test:security
# bump "version" in package.json to match the tag about to be created
npm install --package-lock-only --ignore-scripts
git add package.json package-lock.json
git commit -m "chore(release): vX.Y.Z"
git push github HEAD:main && git push gitlab HEAD:main
git tag -a vX.Y.Z -m "vX.Y.Z — <short summary>"
git push github vX.Y.Z && git push gitlab vX.Y.Z
```

The tag push triggers `.github/workflows/docker-publish.yml`, which gates on the
unit suite, the audit, the bundle scan, the hermetic browser suite and a
container health check before publishing to `ghcr.io`. A red pipeline means the
release is not shipped; fix forward and cut the next version.

### Dependencies in worktrees

`node_modules` is gitignored and not tracked. It used to be a committed symlink
into the main checkout so worktrees inherited its dependencies; that broke as
soon as `npm ci` ran anywhere. Every worktree installs its own with `npm ci`.

### Deploying

```sh
npm run deploy:production
```

Verifies the publish run, deploys that exact digest on Alice, checks the running
revision and runs the production smoke suite. It fails closed on a dirty
worktree, an unpushed commit, a missing or failed publish, a revision mismatch,
or a failed smoke test. Production otherwise picks the change up on the daily
04:00 Europe/London Watchtower cycle.

### When to stop and ask

Push and release without asking. Ask first only when the change is not yet
verifiable end to end — an integration that has never run against a real
Nextcloud, or a feature whose acceptance criteria are still open.
