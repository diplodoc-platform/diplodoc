#!/usr/bin/env node
/**
 * Release train orchestrator — dependency-aware merge / release / bump / CI
 * scheduler.
 *
 * Packages whose in-train upstreams have released run concurrently (see
 * scheduler.js), bounded by `defaults.concurrency`. All state mutations happen
 * on the single JS thread between awaits, and every `gh` call is synchronous,
 * so concurrent packages cannot interleave inside a persist.
 *
 * The tracking issue is updated on `persist()`, which makes it the live
 * dashboard (GitHub renders `$GITHUB_STEP_SUMMARY` only after a step ends) and
 * the durable state a later resume reads back.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { tokenManagerFromEnv } from './app-token.js';
import { setTokenManager } from './gh.js';
import { processPackage } from './process-package.js';
import {
  blockedByFailure,
  buildTrainDag,
  readyRepos,
  resolveConcurrency,
  trainEdges,
} from './scheduler.js';
import {
  findPackage,
  isPackageCompleted,
  mergePlanWithRestoredState,
  saveState,
  serializeTrainState,
  updatePackage,
} from './state.js';
import { publishSummary } from './render-summary.js';
import { renderProgressGraph } from './render-graph.js';
import {
  RT_STATE_BEGIN,
  closeTrainIssue,
  commentTrainIssue,
  renderIssueBody,
  updateTrainIssue,
} from './tracking-issue.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'string', default: 'plan.json' },
    'state-file': { type: 'string', default: 'train-state.json' },
    'status-dir': { type: 'string', default: '.release-train-status' },
  },
});

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const approverToken = process.env.INFRA_APPROVER_PAT || token;
if (!token) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}

const plan = JSON.parse(readFileSync(values.plan, 'utf8'));
const config = loadConfig();
const org = plan.org || config.org;
const defaults = config.defaults;
const trainId = plan.trainId || null;
const mode = plan.mode || 'feature-prs';
const issue = plan.issue || null;
const restored = plan.restoredState || null;
const trainTitle = trainId ? `Release train ${trainId}` : 'Release train';

// A train routinely runs longer than the 1-hour installation-token lifetime.
// With App credentials in the environment the orchestrator re-mints tokens
// itself; without them it keeps using the workflow-minted one as before.
const tokenManager = tokenManagerFromEnv({ owner: org, initialToken: token });
if (tokenManager) {
  setTokenManager(tokenManager);
  tokenManager.refresh();
} else {
  console.log(
    '::notice title=release train::RT_APP_ID/RT_APP_PRIVATE_KEY are not set — the run is limited to the lifetime of the workflow token',
  );
}

const state = mergePlanWithRestoredState(plan, restored);
const publishedByNpm = { ...(restored?.publishedByNpm || {}) };

const dag = buildTrainDag(plan.packages, config.graph, config.nodesByRepo);
const concurrency = resolveConcurrency(plan.concurrency, defaults.concurrency, 3);

let issueBodyCache = null;
let lastIssueWriteAt = 0;
// A permission error will not fix itself mid-run: report it once, keep the
// train going and stop hammering the API on every poll.
let issueWritesDisabled = false;

// 401 is not permanent any more: ghRaw re-mints the App token and retries, so
// only a genuine permission/lookup problem may silence issue writes.
function isPermanentApiError(message) {
  return /HTTP (403|404)/.test(message);
}

function updateTrackingIssue({
  status = 'running',
  finishedAt = null,
  error = null,
  force = false,
} = {}) {
  if (!issue?.number || issueWritesDisabled) return;

  // Several packages poll concurrently; without a floor between writes the
  // dashboard would eat a PATCH per poll per package.
  const minIntervalS = defaults.issue_update_min_interval_s ?? 20;
  if (!force && Date.now() - lastIssueWriteAt < minIntervalS * 1000) return;

  const body = renderIssueBody({
    trainId,
    mode,
    status,
    state,
    workflow: plan.workflow,
    graph: renderProgressGraph(state.packages, { edges: trainEdges(dag) }),
    diagnostics: error ? { message: error } : null,
    rtState: serializeTrainState({
      trainId,
      mode,
      status,
      issue,
      workflow: plan.workflow,
      state,
      publishedByNpm,
      drift: restored?.drift || null,
      error,
      finishedAt,
    }),
  });

  // The RT-STATE timestamp changes on every render, so compare everything but
  // the hidden block to avoid a PATCH per poll when nothing actually moved.
  const visible = body.split(RT_STATE_BEGIN)[0];
  if (visible === issueBodyCache) return;
  issueBodyCache = visible;

  try {
    updateTrainIssue({
      owner: issue.owner,
      repo: issue.repo,
      issueNumber: issue.number,
      body,
      token,
    });
    lastIssueWriteAt = Date.now();
  } catch (err) {
    console.warn(`::warning::Could not update tracking issue #${issue.number}: ${err.message}`);
    if (isPermanentApiError(err.message)) {
      issueWritesDisabled = true;
      console.warn(
        '::warning::Tracking issue updates are disabled for the rest of this run — the resume state ' +
          'in RT-STATE will be stale. Check that the GitHub App has "Issues: Read and write".',
      );
    }
  }
}

function persist(options) {
  saveState(state, values['state-file']);
  publishSummary(state, trainTitle);
  writeStatusArtifacts();
  updateTrackingIssue(options);
}

function writeStatusArtifacts() {
  mkdirSync(values['status-dir'], { recursive: true });
  for (const pkg of state.packages) {
    writeFileSync(
      `${values['status-dir']}/status-${pkg.repo}.json`,
      `${JSON.stringify(
        {
          repo: pkg.repo,
          status: pkg.status,
          feature_pr: pkg.featurePr?.number,
          feature_pr_url: pkg.featurePr?.url,
          release_pr: pkg.releasePr?.number,
          release_pr_url: pkg.releasePr?.url,
          npm_version: pkg.npmVersion,
          ci: pkg.ci,
          snapshots: pkg.snapshots,
          error: pkg.error,
        },
        null,
        2,
      )}\n`,
    );
  }
}

persist();

/** Shared context handed to the per-package pipeline (process-package.js). */
const ctx = {
  org,
  // Resolved per read: bump-downstream pushes with this token over git, which
  // does not go through gh.js and so cannot benefit from its refresh path.
  get token() {
    return tokenManager ? tokenManager.get() : token;
  },
  approverToken,
  config,
  defaults,
  trainId,
  issue,
  branchName: plan.branchName,
  targetBranch: defaults.target_branch || 'master',
  publishedByNpm,
  updateLockfile: config.capabilities?.update_lockfile?.default !== false,
  findPackage: (repo) => findPackage(state, repo),
  updatePackage: (repo, patch) => updatePackage(state, repo, patch),
  persist,
  now: () => new Date().toISOString(),
  notify: (body) => {
    if (!issue?.number) return;
    try {
      commentTrainIssue({
        owner: issue.owner,
        repo: issue.repo,
        issueNumber: issue.number,
        body,
        token,
      });
    } catch (err) {
      console.warn(`::warning::Could not comment on tracking issue: ${err.message}`);
    }
  },
};

async function run() {
  if (plan.dryRun) {
    for (const entry of plan.packages) {
      if (isPackageCompleted(findPackage(state, entry.repo))) continue;
      updatePackage(state, entry.repo, { status: 'queued (dry-run)' });
    }
    persist({ status: 'dry-run', force: true });
    console.log('Dry run complete — no merges performed.');
    return;
  }

  // Absorb progress from earlier runs before scheduling anything: a package
  // already released in a previous run still has to feed publishedByNpm.
  for (const entry of plan.packages) {
    const pkgState = findPackage(state, entry.repo);
    if (isPackageCompleted(pkgState)) {
      console.log(`Skipping ${entry.repo} — already ${pkgState.status} in train ${trainId}`);
      if (pkgState.npmVersion && entry.npm && !publishedByNpm[entry.npm]) {
        publishedByNpm[entry.npm] = pkgState.npmVersion;
      }
    } else if (pkgState?.status === 'failed' || pkgState?.status === 'blocked') {
      console.log(`Retrying ${entry.repo} after previous ${pkgState.status}`);
      updatePackage(state, entry.repo, {
        status: 'queued',
        error: null,
        finishedAt: null,
        blockedBy: null,
      });
    }
  }
  persist();

  const failures = [];
  const running = new Map();
  const entryByRepo = new Map(plan.packages.map((entry) => [entry.repo, entry]));
  const statusOf = (repo) => findPackage(state, repo)?.status || 'queued';

  console.log(
    `Scheduling ${plan.packages.length} package(s) with concurrency ${concurrency} ` +
      `(${trainEdges(dag).length} in-train dependency edge(s))`,
  );

  while (true) {
    const ready = readyRepos({
      packages: plan.packages,
      dag,
      statusOf,
      running: new Set(running.keys()),
    });

    for (const repo of ready.slice(0, Math.max(0, concurrency - running.size))) {
      running.set(
        repo,
        processPackage(ctx, entryByRepo.get(repo)).then(
          () => ({ repo, ok: true }),
          (err) => ({ repo, ok: false, err }),
        ),
      );
    }

    if (!running.size) break;

    const settled = await Promise.race(running.values());
    running.delete(settled.repo);
    if (settled.ok) continue;

    const { repo, err } = settled;
    updatePackage(state, repo, {
      status: 'failed',
      error: err.message,
      finishedAt: new Date().toISOString(),
    });

    // Only the packages that depend on the failed one are stopped; everything
    // independent keeps running, so one bad package does not cost the train.
    const blocked = blockedByFailure(repo, dag, statusOf).filter((other) => !running.has(other));
    for (const other of blocked) {
      updatePackage(state, other, { status: 'blocked', blockedBy: repo });
    }

    failures.push({ repo, message: err.message });
    persist({ error: `${repo}: ${err.message}`, force: true });
    reportFailure(repo, err.message, blocked);
    console.error(`::error::[${repo}] ${err.message}`);
  }

  if (failures.length) {
    const finishedAt = new Date().toISOString();
    const summary = failures.map((f) => `${f.repo}: ${f.message}`).join('; ');
    persist({ status: 'failed', finishedAt, error: summary, force: true });
    console.error(`::error::Release train ${trainId} finished with ${failures.length} failure(s)`);
    process.exit(1);
  }

  finish();
}

function reportFailure(repo, message, blocked = []) {
  if (!issue?.number) return;
  const runLink = plan.workflow?.runUrl ? ` ([run](${plan.workflow.runUrl}))` : '';
  try {
    commentTrainIssue({
      owner: issue.owner,
      repo: issue.repo,
      issueNumber: issue.number,
      body: [
        `❌ Release train \`${trainId}\` failed on \`${repo}\`${runLink}:`,
        '',
        `> ${message}`,
        '',
        ...(blocked.length
          ? [`Blocked downstream packages: ${blocked.map((r) => `\`${r}\``).join(', ')}.`, '']
          : []),
        'Independent packages keep running.',
        `Fix the cause and comment \`/rt resume\` to continue from this point.`,
      ].join('\n'),
      token,
    });
  } catch (err) {
    console.warn(`::warning::Could not comment on tracking issue: ${err.message}`);
  }
}

function finish() {
  const finishedAt = new Date().toISOString();
  publishSummary(state, `${trainTitle} (complete)`);
  updateTrackingIssue({ status: 'success', finishedAt, force: true });

  // One batch of `owner/repo#N` references: a single comment cross-links the
  // issue with every PR the train merged, instead of one mention event per PR.
  const mergedPrRefs = state.packages
    .filter((p) => isPackageCompleted(p))
    .map((p) => {
      const refs = [p.featurePr, p.releasePr]
        .filter((pr) => pr?.number)
        .map((pr) => `${org}/${p.repo}#${pr.number}`);
      return refs.length ? `- \`${p.repo}\`: ${refs.join(', ')}` : null;
    })
    .filter(Boolean);

  if (issue?.number && defaults.close_issue_on_success !== false) {
    try {
      commentTrainIssue({
        owner: issue.owner,
        repo: issue.repo,
        issueNumber: issue.number,
        body: [
          `✅ Release train \`${trainId}\` completed.`,
          '',
          ...state.packages
            .filter((p) => p.npmVersion)
            .map((p) => `- \`${p.npm || p.repo}\` → \`${p.npmVersion}\``),
          ...(mergedPrRefs.length ? ['', '**Merged pull requests:**', ...mergedPrRefs] : []),
        ].join('\n'),
        token,
      });
      closeTrainIssue({
        owner: issue.owner,
        repo: issue.repo,
        issueNumber: issue.number,
        token,
      });
      console.log(`Closed tracking issue #${issue.number}`);
    } catch (err) {
      console.warn(`::warning::Could not close tracking issue: ${err.message}`);
    }
  }

  console.log('Release train completed successfully.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
