#!/usr/bin/env node
/**
 * Release train orchestrator — sequential merge / release / bump / CI loop.
 *
 * The tracking issue is updated on every `persist()`, which makes it the live
 * dashboard (GitHub renders `$GITHUB_STEP_SUMMARY` only after a step ends) and
 * the durable state a later resume reads back.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { mergePr } from './gh.js';
import { waitForReleasePleaseMerge } from './wait-release-please.js';
import { waitForNpmPackage, readPackageVersionFromRepo } from './wait-npm.js';
import { bumpDownstreamDeps } from './bump-downstream.js';
import { waitForCiGreen } from './wait-ci.js';
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

const state = mergePlanWithRestoredState(plan, restored);
const publishedByNpm = { ...(restored?.publishedByNpm || {}) };

let issueBodyCache = null;
// A permission error will not fix itself mid-run: report it once, keep the
// train going and stop hammering the API on every poll.
let issueWritesDisabled = false;

function isPermanentApiError(message) {
  return /HTTP (401|403|404)/.test(message);
}

function branchOf(repo) {
  return findPackage(state, repo)?.featurePr?.headRefName || plan.branchName;
}

function updateTrackingIssue({ status = 'running', finishedAt = null, error = null } = {}) {
  if (!issue?.number || issueWritesDisabled) return;

  const body = renderIssueBody({
    trainId,
    mode,
    status,
    state,
    workflow: plan.workflow,
    graph: renderProgressGraph(state.packages),
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

async function waitCiForRepo(repo) {
  const pkgState = findPackage(state, repo);
  if (!pkgState?.featurePr) return;

  updatePackage(state, repo, { status: 'waiting_ci' });
  persist();

  const result = await waitForCiGreen({
    owner: org,
    repo,
    featurePr: pkgState.featurePr,
    branchName: branchOf(repo),
    token,
    config,
    pollIntervalS: defaults.ci_poll_interval_s || 90,
    timeoutMin: defaults.ci_poll_timeout_min || 360,
    onPoll: ({ ci, snapshots, mergeReadiness }) => {
      updatePackage(state, repo, { ci, snapshots, mergeReadiness });
      persist();
    },
  });

  updatePackage(state, repo, {
    ci: result.ci,
    snapshots: result.snapshots,
  });
  persist();
}

/**
 * Deferred dependency bump: one commit on the package's feature branch with
 * every version published so far, applied right before the package's turn.
 * In topological order all in-train upstreams have released by that point, so
 * `publishedByNpm` is exactly the accumulated set — one commit, one CI rerun,
 * instead of the previous per-release fan-out over every remaining PR.
 * `bumpDownstreamDeps` is idempotent, so a resume replays this as a no-op.
 */
function applyPendingBump(entry) {
  const pkg = findPackage(state, entry.repo);
  if (!pkg?.featurePr?.number) return;
  if (!Object.keys(publishedByNpm).length) return;

  updatePackage(state, entry.repo, { status: 'bumping' });
  persist();

  const results = bumpDownstreamDeps({
    owner: org,
    token,
    branchName: plan.branchName,
    publishedVersions: { ...publishedByNpm },
    targets: [{ repo: entry.repo, featurePr: pkg.featurePr, branch: pkg.featurePr.headRefName }],
    updateLockfile: config.capabilities?.update_lockfile?.default !== false,
    trainId,
    issueRef: issue,
  });

  if (results[0]?.bumped) {
    updatePackage(state, entry.repo, { bumpedDeps: { ...publishedByNpm } });
    persist();
  }
}

async function run() {
  if (plan.dryRun) {
    for (const entry of plan.packages) {
      if (isPackageCompleted(findPackage(state, entry.repo))) continue;
      updatePackage(state, entry.repo, { status: 'queued (dry-run)' });
    }
    persist({ status: 'dry-run' });
    console.log('Dry run complete — no merges performed.');
    return;
  }

  for (let i = 0; i < plan.packages.length; i++) {
    const entry = plan.packages[i];
    const repo = entry.repo;
    const pkgState = findPackage(state, repo);

    if (isPackageCompleted(pkgState)) {
      console.log(`Skipping ${repo} — already ${pkgState.status} in train ${trainId}`);
      if (pkgState.npmVersion && entry.npm && !publishedByNpm[entry.npm]) {
        publishedByNpm[entry.npm] = pkgState.npmVersion;
      }
      continue;
    }

    if (pkgState?.status === 'failed') {
      console.log(`Retrying ${repo} after previous failure: ${pkgState.error || 'unknown error'}`);
      updatePackage(state, repo, { status: 'queued', error: null, finishedAt: null });
      persist();
    }

    try {
      applyPendingBump(entry);

      await waitCiForRepo(repo);

      updatePackage(state, repo, {
        status: 'merging',
        startedAt: findPackage(state, repo)?.startedAt || new Date().toISOString(),
      });
      persist();

      mergePr(org, repo, entry.featurePr.number, entry.merge_method || 'rebase', token);

      updatePackage(state, repo, { status: 'release_pending' });
      persist();

      const releaseTimeout = entry.auto_approve_release
        ? defaults.release_poll_timeout_min || 30
        : defaults.manual_release_timeout_min || 240;

      const rp = await waitForReleasePleaseMerge({
        owner: org,
        repo,
        token,
        approverToken,
        autoApprove: entry.auto_approve_release,
        mergeMethod: entry.merge_method || 'rebase',
        pollIntervalS: defaults.release_poll_interval_s || 30,
        timeoutMin: releaseTimeout,
        onReleasePr: ({ releasePr, pendingVersion }) => {
          updatePackage(state, repo, { releasePr, pendingVersion });
          persist();
        },
      });

      updatePackage(state, repo, { releasePr: rp.releasePr });

      if (rp.waitingManual) {
        updatePackage(state, repo, { status: 'waiting_release_review' });
        persist();
        throw new Error(
          `Timed out waiting for manual release PR merge: ${org}/${repo}#${rp.releasePr.number}`,
        );
      }

      const version = readPackageVersionFromRepo(org, repo, 'master', token);
      await waitForNpmPackage(entry.npm, version, defaults.npm_wait_timeout_min || 15);
      publishedByNpm[entry.npm] = version.replace(/^v/, '');

      updatePackage(state, repo, {
        status: 'released',
        npmVersion: publishedByNpm[entry.npm],
      });
      persist();

      updatePackage(state, repo, {
        status: 'done',
        finishedAt: new Date().toISOString(),
      });
      persist();
    } catch (err) {
      updatePackage(state, repo, {
        status: 'failed',
        error: err.message,
        finishedAt: new Date().toISOString(),
      });
      const finishedAt = new Date().toISOString();
      persist({ status: 'failed', finishedAt, error: `${repo}: ${err.message}` });
      reportFailure(repo, err.message);
      console.error(`::error::${err.message}`);
      process.exit(1);
    }
  }

  finish();
}

function reportFailure(repo, message) {
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
  updateTrackingIssue({ status: 'success', finishedAt });

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
