# Release train — cross-package PR orchestrator

Automated cascade for Diplodoc metapackage changes that span multiple `@diplodoc/*` submodules. Developers open feature PRs in affected repos; after human review, a single release train workflow merges, releases, bumps downstream deps, and waits for CI — bottom-up along the dependency graph.

The train is identified by `train_id`. Feature PRs no longer need to share the same branch name: the preferred input is an explicit PR list, while branch-based discovery remains as a backward-compatible fallback.

Detailed implementation plan: [`plans/release-train-tracking-issue.md`](../plans/release-train-tracking-issue.md). Related `update-deps.yml` plan: [`plans/update-deps-drift-branch.md`](../plans/update-deps-drift-branch.md).

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
- `defaults.issue_owner`: `diplodoc-platform`
- `defaults.issue_repo`: `diplodoc`
- `defaults.close_issue_on_success`: `true`
- `defaults.target_branch`: branch feature PRs must target (`master`)
- `repos.<slug>`: `auto_approve_release`, `auto_merge_feature` (per-repo)
- `capabilities.update_snapshots`: repo → workflow path (e.g. `cli` → `update-snapshots.yml`)
- `capabilities.update_lockfile`: default on for bump-downstream commits
- `commands.aliases` / `commands.actions`: accepted issue-comment commands
- `commands.team_org` / `commands.team_slug`: team whose active members may run them

Critical packages (`cli`, `transform`, `components`): can opt out of auto-approve/auto-merge via repo config.

## 3. Workflow

**Path:** [`.github/workflows/release-train.yml`](../.github/workflows/release-train.yml)

**Triggers:**
- `workflow_dispatch` — normal start / resume
- issue comment command is handled by a lightweight command workflow and dispatches this workflow

Related workflows:

| Workflow | Role |
| --- | --- |
| [`.github/workflows/release-train.yml`](../.github/workflows/release-train.yml) | The train itself |
| [`.github/workflows/release-train-command.yml`](../.github/workflows/release-train-command.yml) | `issue_comment` router for `/rt …` commands |
| [`.github/workflows/release-train-audit.yml`](../.github/workflows/release-train-audit.yml) | Dependency drift audit + drift issue |
| [`.github/workflows/release-train-drift-start.yml`](../.github/workflows/release-train-drift-start.yml) | Drift plan → update-deps PRs → train dispatch |

**Inputs:**

| Input | Purpose |
| --- | --- |
| `train_id` | Optional. Required for manual resume; generated as `rt-<run_number>` on first run if empty. |
| `prs` | Preferred participant input: comma-separated PR refs (`cli#123`, `owner/repo#123`, or PR URLs). |
| `branch_name` | Backward-compatible discovery fallback; can also be used with `train_id` to add scope on resume. |
| `packages` | Optional repo subset for branch fallback. |
| `dry_run` | Plan + summary only, no merges. |

**Secrets:** `INFRA_APP_ID`, `INFRA_APP_PRIVATE_KEY`, `INFRA_APPROVER_PAT`.

Everything except release-PR approval runs with the GitHub App installation token. Required App permissions:

| Permission | Why |
| --- | --- |
| `Issues: Read and write` on `diplodoc-platform/diplodoc` | create/update/close the tracking issue, labels, comments |
| `Pull requests: Read and write` on package repos | read PRs, merge, backlink comments |
| `Contents: Read and write` on package repos | bump commits, `drift-<train_id>` branches |
| `Actions: Read and write` | dispatch `release-train.yml`, `update-deps.yml`, snapshot workflows and poll their runs |
| org `Members: Read` | team-membership check for issue commands |

`INFRA_APPROVER_PAT` is used only to approve release PRs (`Pull requests: Read and write` on package repos); the train falls back to the App token when it is absent.

Without `Issues: Read and write` the App can still create the tracking issue and
its label, but `PATCH /issues/:n` and issue comments return
`403 Resource not accessible by integration` and labels are silently dropped
from the new issue. Since that means `RT-STATE` is never written, `prepare`
treats the first issue write as mandatory and fails the run instead of starting
a train that cannot be resumed.

### Job `prepare`

- Run [`scripts/release-train/prepare.js`](../scripts/release-train/prepare.js)
- Resolve `train_id` (input or generated)
- Ensure tracking issue `Release train: <train_id>` in `diplodoc-platform/diplodoc`
- Parse existing `RT-STATE` from issue if it exists
- Discover participants from:
  1. restored state from issue
  2. explicit `prs`
  3. `branch_name` fallback
- Merge scopes: `restored ∪ prs ∪ branch fallback`
- Topo-sort affected packages; validate upstream/downstream constraints
- Write initial queued report to tracking issue
- Add idempotent backlink comments to feature PRs
- Output artifact: `plan.json`

### Job `orchestrate`

Before the loop, a resume replays `publishedByNpm` onto every still-open feature PR, so packages added after earlier releases start from the published versions.

Sequential loop per package in topo order (packages already `done`/`released` are skipped, `failed` ones are reset and retried):

1. Preflight — PR approved, mergeable
2. Merge feature PR (rebase/squash per config)
3. Wait release-please PR → auto-approve if allowed → auto-merge → poll until MERGED
4. Wait npm publish (`npm view @pkg@version`, same as distribute-infra)
5. Bump `@diplodoc/*` versions in remaining open feature PRs (each on its own head branch) + lockfile refresh
6. Wait CI — poll on failure, do not exit until green/timeout
7. Persist status into local state, `$GITHUB_STEP_SUMMARY`, log output, and tracking issue

**Live report:** `$GITHUB_STEP_SUMMARY` is still written for final job summary, but GitHub renders it only after the step finishes. The live dashboard is the tracking issue, updated from `persist()`.

**Finalization:** on success, the issue is updated one last time, gets a comment listing the published versions, and is closed automatically (`defaults.close_issue_on_success`). On failure, the issue stays open, records the error in `RT-STATE` and the diagnostics block, and gets a comment with the `/rt resume` hint.

## 4. Tracking issue and `RT-STATE`

Tracking issue is the durable source of truth for a train.

**Title:** `Release train: <train_id>`

**Labels:**
- `release-train:<train_id>`
- optional `release-train-drift` for drift audit issues

Issue body contains:

1. Markdown report table
2. Workflow run links
3. Feature PR links
4. Mermaid progress graph
5. Optional diagnostics graph
6. Hidden state block:

```md
<!-- RT-STATE
{ "version": 1, "trainId": "rt-123", "state": { "packages": [] } }
RT-STATE -->
```

The hidden block stores:
- train metadata
- participants
- per-package status
- `publishedByNpm`
- feature/release PR links
- npm versions
- CI/snapshot status
- drift update plan if mode is `dependency-drift`

The block lives in editable storage and its values flow back into git refs,
`gh` arguments and `package.json` ranges, so it is treated as untrusted input:

- `restoreTrainState` re-validates every restored value (repo slug, PR number,
  branch name, npm name/version) and drops what does not match; unknown
  statuses fall back to `queued`, because redoing work is safe and skipping is
  not.
- the visible part of the issue body is assembled from untrusted strings (PR
  titles, error messages), so its HTML comment delimiters are escaped — a
  forged `RT-STATE` block in an error message cannot shadow the real one.
- `/rt start` only accepts package names present in the committed dependency
  graph, so a hand-edited drift plan cannot make a consumer repo install an
  arbitrary npm package.

## 5. Resume semantics

A failed train can be restarted with the same `train_id`.

On resume:

1. `prepare` finds the existing tracking issue by label.
2. `prepare` parses `RT-STATE`.
3. Any new `prs` or `branch_name` discovery is merged with restored participants.
4. `orchestrate` restores state and `publishedByNpm`.
5. Packages in `done`/`released` are skipped.
6. The first failed/not-started package is retried.

### Adding PRs during resume

Allowed:
- adding new downstream PRs after already released upstream packages

Rejected:
- adding a new upstream package before an already released downstream package

On rejected topology changes, tracking issue should show a Mermaid diagnostics graph with:
- green nodes — already released/done
- yellow nodes — queued
- red node/edge — newly added conflicting upstream

## 6. Issue commands

A separate command workflow handles `issue_comment` events on tracking issues.

Supported aliases:

```txt
/release-train retry
/release-train resume
/rt retry
/rt resume
/train retry
/train resume
```

Optional PR extension:

```txt
/rt resume prs=cli#123,transform#456
```

Drift start commands:

```txt
/release-train start
/rt start
/train start
```

Security checks (all enforced in `handle-command.js`, which runs from the default branch):
- issue belongs to `defaults.issue_owner`/`defaults.issue_repo`
- issue carries a `release-train:<id>` label (`start` additionally requires `release-train-drift`)
- comment author is an *active* member of `commands.team_org`/`commands.team_slug`; any API failure counts as "not a member"
- command and action are allowlisted in `commands.*`

Accepted commands get an `eyes` reaction and a reply with the dispatched run URL; rejected ones get a one-line reason.

At the bottom of each tracking issue, include a small hint:

```md
_Commands: `/rt resume` to restart this train, `/rt resume prs=cli#123` to resume and add PRs._
```

For drift issues:

```md
_Commands: `/rt start` to create dependency update PRs and run this train._
```

## 7. Summary table columns

| Column | Description |
| --- | --- |
| Repo | GitHub repo slug |
| Feature PR | Link to feature PR |
| Status | queued / merging / release_pending / released / waiting_ci / failed / done |
| Release PR | Link to release-please PR when present |
| npm | Published version after release |
| CI | Overall check status + link to failing job |
| Snapshots | Auto snapshot/screenshot update outcome |
| Duration | Step or total duration |

Example snapshot cells:
- `—` — not applicable / not triggered
- `📸 updated` — bot pushed snapshot fix; link to commit or bot workflow run
- `📸 failed` — update workflow failed; link to logs
- `⏳ running` — update-snapshots workflow in progress

## 8. Auto snapshot / screenshot update

**Scope:** integrated into orchestrate loop. Config-driven via `capabilities.update_snapshots`.

**Path (reference impl):** [`packages/cli/.github/workflows/update-snapshots.yml`](../packages/cli/.github/workflows/update-snapshots.yml)

**When CI fails on a feature branch during `wait-ci`:**
1. Classify failure: check name matches `/e2e|integration|playwright|snapshot|screenshot/i` and repo listed in config
2. Dispatch repo's update-snapshots workflow (`gh workflow run … -f pr_number=…`)
3. Poll until completion
4. Update summary **Snapshots** column + PR comment listing changed paths
5. Resume CI poll

### Dismiss approval after snapshot bot push (auto-merge safety)

If the feature PR has auto-merge enabled, a bot snapshot commit must not merge without re-review.

After successful snapshot push:
1. Dismiss all bot approvals on that PR
2. Set summary status to `waiting_review` / CI cell `⏸ re-approval required`
3. Poll until new human approval and CI green
4. Only then proceed to merge feature step or next train step

Train must never merge a PR while `Snapshots=📸 updated` and approvals were dismissed until re-approved.

## 9. Release-please cycle (per package)

Full cycle:

1. Merge feature PR → master
2. Wait release-please PR (`release-please--branches--master`, author `yc-ui-bot`)
3. Approve + merge release PR (auto or manual per repo config)
4. Wait GitHub Release tag + npm registry
5. Bump downstream open PRs
6. Wait CI (+ snapshot flow if needed)

## 10. Drift audit and start

Separate but integrated mode for stale `@diplodoc/*` dependencies in master branches.

### Audit

New script: `scripts/release-train/audit-drift.js`

The audit:
- scans repos from [`release-train.yml`](../release-train.yml)
- reads `package.json` from master
- finds `@diplodoc/*` dependencies in prod/dev/peer sections
- compares declared versions with npm latest
- creates a drift issue when `create_issue=true`
- stores a machine-readable update plan in `RT-STATE.drift`

### Start from drift issue

`/rt start` turns a drift issue into a real dependency-update train:

1. Parse `RT-STATE.drift`
2. Create or reuse deterministic branch `drift-<train_id>` in each consumer repo
3. Run existing [`update-deps.yml`](../devops/infra/scaffolding/.github/workflows/update-deps.yml) on that branch
4. Pass `packages=<list>`, `version=latest`, `create_pr=true`
5. Find/create PR from `drift-<train_id>` to `master`
6. Add backlink to tracking issue
7. Dispatch main release train with created PRs

Important boundaries:
- [`update-deps.yml`](../devops/infra/scaffolding/.github/workflows/update-deps.yml) does not know about `train_id`
- release train owns drift branch creation and tracking issue linkage
- `update-deps.yml` has a `create_pr` input that only applies on non-master branches (ignored on master, default `false`), described in [`plans/update-deps-drift-branch.md`](../plans/update-deps-drift-branch.md)

The drift audit reports peer dependencies but never auto-updates them: `npm install --save*` cannot write `peerDependencies`.

## 11. Scripts layout

**Path:** [`scripts/release-train/`](../scripts/release-train/)

| File | Role |
| --- | --- |
| `prepare.js` | PR discovery, resume-state lookup, validation, plan |
| `orchestrate.js` | Sequential train execution |
| `pr-refs.js` | `prs` input parser (`repo#123`, `owner/repo#123`, URL) |
| `topology.js` | Dependency closure, upstream conflict and missing-upstream guards |
| `wait-release-please.js` | Find / approve / merge release PR |
| `wait-npm.js` | Registry poll, `package.json` read, npm latest lookup |
| `bump-downstream.js` | Version bump commits on each PR's own branch |
| `wait-ci.js` | Check poll + snapshot dispatch + approval dismiss |
| `render-summary.js` | Markdown table renderer |
| `render-graph.js` | Mermaid progress/diagnostics graph renderer |
| `tracking-issue.js` | Tracking issue, hidden state, backlink comments |
| `state.js` | Train state persistence, `RT-STATE` serialize/restore/merge |
| `commands.js` | Issue-comment command parser (pure) |
| `handle-command.js` | Command handler: validation, team check, dispatch |
| `drift.js` | Version comparison and update-plan helpers (pure) |
| `audit-drift.js` | Drift audit and update-plan generation |
| `start-drift-train.js` | Drift issue → update-deps PRs → release train dispatch |
| `gh.js` | `gh` CLI / REST helpers (PRs, issues, labels, refs, teams) |

Unit tests live next to the modules as `*.test.js` and run with `npm run test:scripts` (node:test).

## 12. Developer contract

1. Prefer opening feature PRs normally in affected submodules; branch names may differ.
2. Start release train with explicit `prs` list.
3. If `prs` is omitted, `branch_name` fallback can discover open PRs by shared branch.
4. For resume, use the same `train_id` from tracking issue.
5. To resume and add scope, pass same `train_id` plus extra `prs` or `branch_name`.
6. Fix failing CI from tracking issue links; train can continue after retry.
7. For dependency drift, run audit with `create_issue=true`, then comment `/rt start` in the drift issue.

## 13. Edge cases

| Case | Behavior |
| --- | --- |
| Upstream PR missing | `prepare` fails with table of missing repos |
| Explicit PR branch names differ | Supported via `prs` input |
| `train_id` + `prs` on resume | Restored participants are merged with new PRs |
| New upstream added after downstream released | Fail with diagnostics graph |
| Package already released in same train | Skip on resume, reuse stored `publishedByNpm` |
| Concurrent trains | Isolated by `train_id` and tracking issue label |
| Snapshot update on auto-merge PR | Dismiss approvals, wait re-approval + green CI |
| dry_run | prepare + initial issue summary only |
| Existing backlink comment | Update/reuse; no duplicate comment |
| Successful train | Tracking issue auto-closes |

## 14. Implementation order

See phased plan with verification pauses in [`plans/release-train-tracking-issue.md`](../plans/release-train-tracking-issue.md).

High-level phases:

1. Tracking issue skeleton and PR discovery
2. Backlinks and live persist
3. Durable resume
4. Issue comment commands
5. Drift audit issue
6. [`update-deps.yml`](../devops/infra/scaffolding/.github/workflows/update-deps.yml) non-master `create_pr` support
7. Drift start command
8. Documentation and hardening

## 15. Related docs

- [`plans/release-train-tracking-issue.md`](../plans/release-train-tracking-issue.md) — detailed implementation plan
- [`plans/update-deps-drift-branch.md`](../plans/update-deps-drift-branch.md) — separate `update-deps.yml` enhancement plan
- [`.agents/dev-infrastructure.md`](../.agents/dev-infrastructure.md) — cascading release (manual today)
- [`.agents/monorepo.md`](../.agents/monorepo.md) — workspace / lockfile procedure
- [PULSE.md](../PULSE.md) — dependency graph visualization
