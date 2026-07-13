# Release train — cross-package PR orchestrator

Automated cascade for Diplodoc metapackage changes that span multiple `@diplodoc/*` submodules. Developers open feature PRs in each affected repo under the **same branch name**; after human review, a single `workflow_dispatch` merges, releases, bumps downstream deps, and waits for CI — bottom-up along the dependency graph.

Pattern reference: [`devops/infra/.github/workflows/distribute-infra.yml`](../devops/infra/.github/workflows/distribute-infra.yml) (summary table, status artifacts, poll loops).

## 1. Dependency graph (`deps-graph`)

**Path:** [`scripts/deps-graph.js`](../scripts/deps-graph.js) → [`deps-graph.json`](../deps-graph.json)

**Problem:** [`scripts/pulse.js`](../scripts/pulse.js) builds Mermaid from Nx graph only. Submodule `package.json` files use semver ranges (`^4.76.7`), so Nx often omits edges (e.g. `cli` → `color-extension` missing in [PULSE.md](../PULSE.md)).

**What it does:**
- Scans `packages/*`, `extensions/*`, `devops/*`
- Reads `dependencies` (+ non-optional `peerDependencies`) for `@diplodoc/*` edges
- Maps npm name → GitHub repo via pulse SECTIONS table + [`.gitmodules`](../.gitmodules) fallback
- Excludes from graph: `infra`, `package-template`, `*-example` (devops-only tooling, not release targets)
- Outputs `nodes`, `edges`, `topoOrder`; fails on cycles

**Pulse fix:** [`scripts/pulse.js`](../scripts/pulse.js) — remove stale `tsconfig` from `DEPENDS_GRAPH_HIDE` and devops SECTIONS row; `renderDepsGraph()` reads `deps-graph.json`.

**npm script:** `npm run deps-graph`

## 2. Release train config

**Path:** [`release-train.yml`](../release-train.yml) (metapackage root)

**Contents:**
- `defaults`: merge method, CI/npm poll intervals, timeouts
- `repos.<slug>`: `auto_approve_release`, `auto_merge_feature` (per-repo)
- `capabilities.update_snapshots`: repo → workflow path (e.g. `cli` → `update-snapshots.yml`)
- `capabilities.update_lockfile`: default on for bump-downstream commits

Critical packages (`cli`, `transform`, `components`): `auto_approve_release: false` — train waits for human merge of release-please PR.

## 3. Workflow

**Path:** [`.github/workflows/release-train.yml`](../.github/workflows/release-train.yml)

**Trigger:** `workflow_dispatch`

| Input | Purpose |
| --- | --- |
| `branch_name` | Shared feature branch (required) |
| `packages` | Optional comma-separated repo slugs; empty = discover all open PRs for branch |
| `dry_run` | Plan + summary only, no merges |

**Secrets:** `INFRA_APP_ID`, `INFRA_APP_PRIVATE_KEY`, `INFRA_APPROVER_PAT` (same as infra distribute).

### Job `prepare`

- Run [`scripts/release-train/prepare.js`](../scripts/release-train/prepare.js)
- Discover PRs: `gh pr list --head <branch_name>`
- Topo-sort affected packages; validate all upstream deps have PRs in the train
- Output artifact: `plan.json`

### Job `orchestrate`

Sequential loop per package in topo order:

1. Preflight — PR approved, mergeable
2. Merge feature PR (rebase/squash per config)
3. Wait release-please PR → auto-approve if allowed → auto-merge → poll until MERGED
4. Wait npm publish (`npm view @pkg@version`, same as distribute-infra)
5. Bump `@diplodoc/*` versions in **remaining** open feature branches + lockfile refresh
6. Wait CI — **poll on failure**, do not exit; continue after green without workflow restart

**Live summary:** rewrite `$GITHUB_STEP_SUMMARY` after every state transition and during CI poll (full table, not append-only).

### Job `report`

- `if: always()` — aggregate status artifacts into final markdown table

## 4. Summary table columns (Phase 1)

| Column | Description |
| --- | --- |
| Repo | GitHub repo slug |
| Feature PR | Link to feature PR |
| Status | queued / merging / release_pending / released / waiting_ci / failed / done |
| Release PR | Link to release-please PR when present |
| npm | Published version after release |
| CI | Overall check status + link to failing job |
| Snapshots | Auto snapshot/screenshot update outcome (see §5) |
| Duration | Step or total duration |

Example snapshot cells:
- `—` — not applicable / not triggered
- `📸 updated` — bot pushed snapshot fix; link to commit or bot workflow run
- `📸 failed` — update workflow failed; link to logs
- `⏳ running` — update-snapshots workflow in progress

## 5. Auto snapshot / screenshot update

**Phase 1 scope:** integrated into orchestrate loop (not deferred). Config-driven via `capabilities.update_snapshots`.

**Path (reference impl):** [`packages/cli/.github/workflows/update-snapshots.yml`](../packages/cli/.github/workflows/update-snapshots.yml)

**When CI fails on a feature branch during `wait-ci`:**
1. Classify failure: check name matches `/e2e|integration|playwright|snapshot|screenshot/i` and repo listed in config
2. Dispatch repo's update-snapshots workflow (`gh workflow run … -f pr_number=…`)
3. Poll until completion
4. Update summary **Snapshots** column + PR comment listing changed paths
5. Resume CI poll

### Dismiss approval after snapshot bot push (auto-merge safety)

If the feature PR has **auto-merge enabled** (or train enabled auto-merge before CI wait), a bot snapshot commit must **not** merge without re-review.

After successful snapshot push:
1. **`gh pr review --dismiss`** all bot approvals on that PR (reuse pattern from [`auto-approve.yml`](../devops/infra/scaffolding/.github/workflows/auto-approve.yml) dismiss-on-new-commits)
2. Set summary status to `waiting_review` / CI cell `⏸ re-approval required`
3. Poll until: new human approval (or configured bot re-approve policy) **and** CI green
4. Only then proceed to merge feature step (if not already merged) or next train step

Train must **never** merge a PR while `Snapshots=📸 updated` and approvals were dismissed until re-approved.

### Amend + force-push (Phase 2 — scaffolding)

Separate change to update-snapshots / package-lock workflows:
- On feature branches only: `git commit --amend` + `git push --force-with-lease` when amending bot's own commit
- Fallback to new commit if branch advanced (human push)
- Track in infra scaffolding distribution

## 6. Release-please cycle (per package)

Full cycle (selected model):

1. Merge feature PR → master
2. Wait release-please PR (`release-please--branches--master`, author `yc-ui-bot`)
3. Approve + merge release PR (auto or manual per repo config)
4. Wait GitHub Release tag + npm registry
5. Bump downstream open PRs
6. Wait CI (+ snapshot flow if needed)

**Pause in GHA:** no native step pause; use poll loops, GitHub Environments with required reviewers for critical release PRs, optional `workflow_dispatch` resume from `train-state.json` artifact.

## 7. Scripts layout

**Path:** [`scripts/release-train/`](../scripts/release-train/)

| File | Role |
| --- | --- |
| `prepare.js` | PR discovery, validation, plan |
| `merge-feature.js` | Merge feature PR |
| `wait-release-please.js` | Find / approve / merge release PR |
| `wait-npm.js` | Registry poll |
| `bump-downstream.js` | Version bump commits on open branches |
| `wait-ci.js` | Check poll + snapshot dispatch + approval dismiss |
| `render-summary.js` | Markdown table renderer |
| `state.js` | `train-state.json` persistence |

## 8. Developer contract

1. Same branch name in every affected submodule (e.g. `feat/pc-utils-api`)
2. Open PRs in dependency order is **not** required before train — but all upstream PRs must exist when train starts
3. Develop locally in metapackage: `npm run git:apply <branch>`, `npm run watch`, testpack
4. After review: Actions → Release train → `workflow_dispatch` with `branch_name`
5. Fix failing CI from summary links; train continues without restart

## 9. Edge cases

| Case | Behavior |
| --- | --- |
| Upstream PR missing | `prepare` fails with table of missing repos |
| Package already on master | Skip feature merge; use latest npm version |
| Concurrent trains | Mutex via environment or `release-train/in-progress` label |
| Snapshot update on auto-merge PR | Dismiss approvals, wait re-approval + green CI |
| dry_run | prepare + initial summary only |

## 10. Implementation order

1. `deps-graph.js` + pulse fix (remove `tsconfig` references)
2. `release-train.yml` config + `prepare.js`
3. Workflow + summary with Snapshots column (stub `—` until hook wired)
4. Orchestrate loop: merge → release-please → npm → bump → wait CI
5. Snapshot auto-fix + approval dismiss
6. Playbook in [`.agents/dev-infrastructure.md`](../.agents/dev-infrastructure.md)
7. (Follow-up) amend force-push in scaffolding; testpack gate; resume artifact

## 11. Related docs

- [`.agents/dev-infrastructure.md`](../.agents/dev-infrastructure.md) — cascading release (manual today)
- [`.agents/monorepo.md`](../.agents/monorepo.md) — workspace / lockfile procedure
- [PULSE.md](../PULSE.md) — dependency graph visualization
