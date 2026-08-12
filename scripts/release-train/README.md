# Release Train

_[Русская версия](README.ru.md) · [Design spec](../../specs/release-train.md)_

A **release train** merges a set of related pull requests across diplodoc
repositories and releases the resulting packages in dependency order, so a
change that spans several packages reaches npm as one consistent set.

For every participating package the train waits for CI, merges the feature PR,
waits for the release-please PR and the npm publish, and only then lets the
packages that depend on it start.

## Running a train

Trains run from the **Release Train** workflow in this repository
(`.github/workflows/release-train.yml`), started manually:

| Input | Meaning |
| --- | --- |
| `prs` | Participants: `cli#123`, `owner/repo#123` or PR URLs, comma separated |
| `branch_name` | Fallback discovery: every repo with an open PR on this branch |
| `packages` | Narrows `branch_name` discovery to these repo slugs |
| `train_id` | Resume key. Leave empty on the first run — it becomes `rt-<run number>` |
| `concurrency` | How many packages to process at once (default from `release-train.yml`) |
| `dry_run` | Build the plan and the dashboard, merge nothing |

Every train gets a **tracking issue** in `diplodoc-platform/diplodoc` titled
`Release train: <train_id>`. That issue is the live dashboard and the durable
state: the hidden `RT-STATE` block at the bottom is what a resume reads back.

## Modes

**Feature PRs** (default) — the participants are pull requests you already
opened. Give them to the workflow through `prs`, or put them all on one branch
and use `branch_name`.

**Dependency drift** — the audit
(`.github/workflows/release-train-audit.yml`) compares each repo's
`@diplodoc/*` ranges against the published versions and opens a drift issue.
Commenting `/rt start` there creates the update PRs and starts a train for
them.

**Dry run** — plans everything, writes the dashboard and the schedule, merges
nothing.

## Commands in the tracking issue

Members of the configured GitHub team can comment:

- `/rt resume` — restart the train from where it stopped
- `/rt resume prs=cli#123` — resume and add participants
- `/rt start` — (drift issues) create the update PRs and start the train

A resume skips packages that are already `done` or `released`, retries failed
and blocked ones, and reconciles reality first: an already merged feature PR, a
merged release PR or an already published version are recognised instead of
being redone or reported as an error.

## Reading the dashboard

| Column | Meaning |
| --- | --- |
| `Repo` | Package repository |
| `Feature PR` | The participating PR, plus a merge-readiness flag (below) |
| `Status` | Where the package is in the pipeline |
| `Release PR` | The release-please PR, shown as soon as it exists |
| `npm` | Published version, or `1.2.3 (pending)` while npm has not confirmed it |
| `CI` | Aggregated CI state of the feature PR (below) |
| `Snapshots` | Snapshot/screenshot update triggered by the train |
| `Duration` | Time since the package started |

### The CI column

One cell aggregates **all** check runs on the feature PR's head commit —
several workflows (Quality across three operating systems, coverage, security,
lockfile, and repo-specific e2e or visual tests) roll up into a single value.
Checks belonging to bots and to the release machinery itself (`auto-approve`,
`release-please`, `publish`, `dependabot`, …) are excluded, since they are not
what the train is waiting for.

- ✅ — every relevant check finished successfully
- ⏳ `pending` — checks are still running and none has failed
- ❌ `[check](link)` — a check failed. Shown **as soon as the first check goes
  red**, with `(N still running)` when others have not finished; you do not
  have to wait for the slowest matrix job to see the failure
- ⏸ `re-approval required` — the train updated snapshots, so a human has to
  review and approve again before the merge

### The merge-readiness flag

Next to the feature PR: ✓ means everything required for the merge is in place;
✗ names what is missing (`review required`, `changes requested`, `conflicts`,
`behind base`, `blocked`). It is a live view of GitHub's own merge state, so a
missing approval is visible long before the train reaches that package.

### Statuses

`queued` → `bumping` → `waiting_ci` → `merging` → `release_pending` →
`released` → `done`, plus:

- ⚠️ `needs human — 17m left` — the merge is blocked (branch protection, a
  missing review). The train arms auto-merge and waits out this countdown; if
  the PR merges in time, the package continues. Configure with
  `merge_grace_min` / `merge_grace_poll_s`.
- ⛔ `blocked by <repo>` — an upstream package failed, so this one cannot run.
  Independent packages keep going.
- `waiting_release_review` — the release PR needs a manual merge and the wait
  timed out.
- `failed` — see the comment in the issue for the reason and `/rt resume`.

## Dependency order and concurrency

The release order comes from the committed `deps-graph.json`. The train builds
its own DAG from it: a package starts when all of **its in-train dependencies**
have been published, so independent packages run in parallel.

`concurrency` (default `3` in `release-train.yml`) bounds how many run at once.
Each package in flight costs roughly 6–10 CI jobs, so 3 keeps a 20-runner pool
busy without starving it. Set `concurrency: 1` for strictly sequential
behaviour. A dry run prints the resulting schedule waves.

## Dependency bumps

When a package is published, the packages still ahead of it in the train need
the new version. The train writes that bump into a package's feature branch
**once, right before that package's turn**, in a single commit listing every
version accumulated so far:

```
chore: bump @diplodoc deps for release train rt-11 (@diplodoc/utils@1.2.3, @diplodoc/client@5.11.2)

Release train: diplodoc-platform/diplodoc#106
```

The issue reference makes the commit show up on the tracking issue's timeline.
One bump per package means one CI rerun per package, instead of a rerun after
every upstream release.

Consequence worth knowing: a feature PR merged by hand **before** its turn
never receives its bump. Merge participants through the train, or let the drift
audit catch it afterwards.

## Long runs

A train regularly runs longer than the one-hour lifetime of a GitHub App
installation token. The orchestrator re-mints the token itself
(`app-token.js`) from `RT_APP_ID` / `RT_APP_PRIVATE_KEY`, proactively before
expiry and once more if a call is rejected, so long CI waits no longer end in
`Bad credentials (HTTP 401)`.

## Configuration and development

- `release-train.yml` — participating repos, per-repo merge/approval policy,
  timeouts, concurrency
- `deps-graph.json` — dependency graph and release order
  (`npm run deps-graph`)
- `npm run test:scripts` — unit tests for these scripts

Local dry run:

```bash
GH_TOKEN=$(gh auth token) node scripts/release-train/prepare.js --prs cli#123 --dry-run --no-issue --output plan.json
```
