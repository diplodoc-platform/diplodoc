# Release Train

_[Русская версия](README.ru.md) · [Design spec](../../specs/release-train.md)_

A **release train** merges a set of related pull requests across diplodoc
repositories and releases the resulting packages in dependency order, so a
change that spans several packages reaches npm as one consistent set.

For every participating package the train waits for CI, merges the feature PR,
waits for the release-please PR and the npm publish, and only then lets the
packages that depend on it start. `vsc` sets `wait_for_npm: false` in
`release-train.yml`: CI and feature/release PR merges still run, but npm polling
and propagation of its version to downstream packages are skipped. Its npm cell
shows `not awaited`; this does not verify publication to another registry.

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
what the train is waiting for. The native `.github/dependabot.yml` (or `.yaml`)
check is identified by the Dependabot App, not its name alone: pending config
bookkeeping is ignored, but configuration failures still block the train.

Release PR merge attempts are retried within the existing timeout after CI is
green. If only native Dependabot config bookkeeping leaves GitHub's merge state
`UNSTABLE`, the train requests a normal protected merge instead of auto-merge.
Both requests match the checked head SHA; branch protection and external commit
statuses remain enforced. No administrator bypass is used.

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

## Preview and start from a human feature PR

Once the optional GitHub App controls are deployed and enabled, the neutral
**Release Train** check offers **Preview train**. GitHub limits button labels to
20 characters, so this is the short label for Preview Release Train.

An explicit section takes precedence over branch discovery:

```markdown
## Release train
- diplodoc-platform/utils#123
- https://github.com/diplodoc-platform/components/pull/456
```

Only this section is interpreted. Unrelated links elsewhere in the description
are ignored; an empty/malformed section is an error and never falls back to branch
search. Without the section, discovery searches the registered release targets for
open PRs with the exact same organization-owned source branch. The originating PR
is always included. Conflicting PRs in one repository, drafts, bots, release PRs, temporary dependency candidates,
forks, foreign repositories and non-master targets stop the control request.

Preview resolves the complete group and runs the existing dependency-graph planner
in dry-run mode, without creating a tracking issue, merging or publishing packages.
Its check lists every PR and SHA and links to the plan. **Start Release Train** uses
that snapshot for at most one hour; changed description, membership, source SHA or
release configuration requires another preview. The operator must be an active
member of the configured release-train team and have current write access to the
metapackage and every source repository.

Start passes the group to the existing train, including CI, reviews, dependency
ordering, release-please and publication waits. Frozen source heads remain bound
through prepare, durable resume state, dependency bumps and `--match-head-commit`.
Only an exact dependency bump made by this train can advance an authorized head.
An independent push or snapshot update stops the controlled merge; it does not
silently authorize new code. Such a stopped train requires explicit human recovery: review the new heads and
start a regular manual train for the remaining open PRs when appropriate. Do not
delete the saved SHA guard from RT-STATE.

All button-started trains (and resumes with their `rt-pr-` IDs) share one concurrency
group with `queue: max`; previews run independently. A queued control older than
one hour expires before execution and needs a fresh preview/start when the queue
is free. This is a failed authorization, never an implicit release. This prevents two button-started groups from
updating the same package concurrently. Ordinary manually dispatched trains retain
their existing policy: do not run one concurrently over a participating source PR.
An exact group is claimed once before prepare. After an early failure or uncertain
response, inspect the linked workflow and tracking issue; do not repeatedly click
Start. If prepare failed before creating resumable RT-STATE, a maintainer must
review the state and explicitly start a regular manual train with the intended PRs.
No claim is automatically deleted or expired to authorize another release.

The App handler holds its existing credentials privately. Public workflows read a
short-lived App check receipt containing the exact operator, source, button and
action; they never trust an arbitrary username or PR description as authorization.
Before authorization succeeds the request check links to the workflow listing;
after authorization it links to the exact run. A failed/lost private dispatch can
leave only a receipt and a Temporal failure: inspect both before retrying.

Rollout is separate: merge both compatible PRs, deploy the Temporal worker before
docs-api, then set `RELEASE_TRAIN_PR_CONTROLS_ENABLED=true` in both services and as
an organization/repository Actions **variable** visible to `diplodoc`. Repository
variables override organization variables. Missing/false values leave this new
route disabled. The existing App needs check writes, workflow dispatch, team
membership and collaborator-permission reads across the registered repositories;
its webhook must deliver pull_request lifecycle and check_run.requested_action.
No new secrets, schedules, distribution or automatic launch is enabled by this PR.

The queue behavior follows [GitHub Actions concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency).
