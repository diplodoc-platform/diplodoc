#!/usr/bin/env node
/**
 * Turn a dependency drift issue into a real release train.
 *
 * For every consumer repo in `RT-STATE.drift`:
 *   1. create (or reuse) the deterministic branch `drift-<train_id>`
 *   2. run the repo's update-deps.yml on that branch with create_pr=true
 *   3. find the resulting PR by branch, add the tracking-issue backlink
 *
 * then dispatch the main release train with the collected PR list.
 *
 * update-deps.yml stays release-train agnostic: the link between a train and
 * its PRs is the branch name, not an input.
 *
 * Usage:
 *   node scripts/release-train/start-drift-train.js --train-id rt-drift-7 --issue-number 42
 */

import { parseArgs } from 'node:util';
import { loadConfig, trainContext } from './config.js';
import {
  createIssueComment,
  dispatchWorkflow,
  ensureBranch,
  findOpenPrByBranch,
  getIssue,
  getLatestWorkflowRun,
} from './gh.js';
import { dispatchFailureHint, updateDepsPackagesInput } from './drift.js';
import { pollUntil, waitMs } from './poll.js';
import { appendSummary } from './render-summary.js';
import {
  DRIFT_COMMANDS_HINT,
  ensureBacklinkComment,
  normalizeTrainId,
  parseTrainState,
  renderIssueBody,
  updateTrainIssue,
} from './tracking-issue.js';

const { values } = parseArgs({
  options: {
    'train-id': { type: 'string' },
    'issue-number': { type: 'string' },
    'update-deps-workflow': { type: 'string', default: 'update-deps.yml' },
    'wait-timeout-min': { type: 'string', default: '20' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}

const config = loadConfig();
const { org, issueOwner, issueRepo, targetBranch } = trainContext(config);
const workflowFile = values['update-deps-workflow'];
const waitTimeoutMin = Number(values['wait-timeout-min']) || 20;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const trainId = normalizeTrainId(values['train-id']);
if (!trainId) fail('--train-id is required');

const issueNumber = Number(values['issue-number']);
if (!Number.isInteger(issueNumber) || issueNumber <= 0) fail('--issue-number is required');

const issue = getIssue(issueOwner, issueRepo, issueNumber, token);
if (!issue) fail(`Issue ${issueOwner}/${issueRepo}#${issueNumber} not found`);

const rtState = parseTrainState(issue.body);
const drift = rtState?.drift;
if (!drift?.updates?.length) {
  fail(`Issue #${issueNumber} has no dependency update plan in RT-STATE.drift`);
}

const driftBranch = `drift-${trainId}`;
const results = [];

for (const update of drift.updates) {
  const repo = update.repo;
  if (!config.repos[repo]) {
    console.warn(`::warning::Skipping ${repo} — not described in release-train.yml`);
    continue;
  }
  // The plan comes from an issue body, and every name here ends up in a
  // consumer repo's `npm install`. Only packages that exist in the committed
  // dependency graph are accepted.
  const known = (update.packages || []).filter((p) => config.nodesByNpm.has(p.name));
  const unknown = (update.packages || []).filter((p) => !config.nodesByNpm.has(p.name));
  if (unknown.length) {
    console.warn(
      `::warning::Ignoring unknown package(s) for ${repo}: ${unknown.map((p) => p.name).join(', ')}`,
    );
  }

  const packages = updateDepsPackagesInput({ ...update, packages: known });
  if (!packages) {
    console.warn(`::warning::Skipping ${repo} — empty package list`);
    continue;
  }

  if (values['dry-run']) {
    console.log(`[dry-run] ${org}/${repo}: branch ${driftBranch}, packages ${packages}`);
    results.push({ repo, packages, branch: driftBranch, pr: null, status: 'dry-run' });
    continue;
  }

  let branchReused = false;
  try {
    const branch = ensureBranch(org, repo, driftBranch, targetBranch, token);
    branchReused = !branch.created;
    console.log(`${org}/${repo}: branch ${driftBranch} ${branch.created ? 'created' : 'reused'}`);

    dispatchWorkflow(
      org,
      repo,
      workflowFile,
      { packages, version: 'latest', create_pr: 'true' },
      token,
      driftBranch,
    );

    // The run needs a moment to be registered before it can be polled.
    await waitMs(10000);
    const run = await pollUntil({
      timeoutMin: waitTimeoutMin,
      intervalS: 20,
      check: () => {
        const r = getLatestWorkflowRun(org, repo, workflowFile, driftBranch, token);
        return r?.status === 'completed' ? r : null;
      },
      onTimeout: () => new Error(`update-deps did not finish within ${waitTimeoutMin}m`),
    });

    if (run.conclusion !== 'success') {
      results.push({ repo, packages, branch: driftBranch, pr: null, status: `update-deps ${run.conclusion}`, url: run.url });
      console.warn(`::warning::update-deps for ${repo} concluded ${run.conclusion}: ${run.url}`);
      continue;
    }

    const pr = findOpenPrByBranch(org, repo, driftBranch, token);
    if (!pr) {
      results.push({ repo, packages, branch: driftBranch, pr: null, status: 'no PR (nothing to update)' });
      console.log(`${org}/${repo}: no PR on ${driftBranch} — dependencies were already up to date`);
      continue;
    }

    ensureBacklinkComment({
      owner: org,
      repo,
      prNumber: pr.number,
      trainId,
      issueUrl: issue.html_url,
      token,
    });

    results.push({ repo, packages, branch: driftBranch, pr: { number: pr.number, url: pr.url }, status: 'ready' });
  } catch (err) {
    const hint = dispatchFailureHint({
      message: err.message,
      branch: driftBranch,
      branchReused,
      targetBranch,
    });
    results.push({
      repo,
      packages,
      branch: driftBranch,
      pr: null,
      status: `failed: ${err.message}${hint}`,
    });
    console.warn(`::warning::Drift start failed for ${repo}: ${err.message}${hint}`);
  }
}

const prs = results.filter((r) => r.pr).map((r) => `${org}/${r.repo}#${r.pr.number}`);

const table = [
  '| Repo | Packages | PR | Status |',
  '| --- | --- | --- | --- |',
  ...results.map(
    (r) =>
      `| \`${r.repo}\` | \`${r.packages}\` | ${r.pr ? `[#${r.pr.number}](${r.pr.url})` : '—'} | ${r.status} |`,
  ),
].join('\n');

console.log(table);
appendSummary([`## Drift start — ${trainId}`, '', table].join('\n'));

const body = renderIssueBody({
  trainId,
  mode: 'dependency-drift',
  status: prs.length ? 'prs-created' : 'no-updates',
  title: `Dependency drift: ${trainId}`,
  sections: [{ heading: 'Dependency update PRs', body: table }],
  hint: DRIFT_COMMANDS_HINT,
  rtState: {
    ...rtState,
    status: prs.length ? 'prs-created' : 'no-updates',
    updatedAt: new Date().toISOString(),
    drift: { ...drift, branch: driftBranch, results },
  },
});

try {
  updateTrainIssue({ owner: issueOwner, repo: issueRepo, issueNumber, body, token });
} catch (err) {
  console.warn(`::warning::Could not update drift issue: ${err.message}`);
}

if (!prs.length) {
  createIssueComment(
    issueOwner,
    issueRepo,
    issueNumber,
    'ℹ️ No dependency update PRs were created — every consumer already uses the latest versions.',
    token,
  );
  console.log('No PRs to run a train for.');
  process.exit(0);
}

if (values['dry-run']) {
  console.log(`[dry-run] Would dispatch release train ${trainId} with: ${prs.join(',')}`);
  process.exit(0);
}

dispatchWorkflow(
  issueOwner,
  issueRepo,
  'release-train.yml',
  { train_id: trainId, prs: prs.join(',') },
  token,
  targetBranch,
);

createIssueComment(
  issueOwner,
  issueRepo,
  issueNumber,
  [`🚂 Release train \`${trainId}\` dispatched with:`, '', ...prs.map((p) => `- ${p}`)].join('\n'),
  token,
);

console.log(`Dispatched release train ${trainId} with ${prs.length} PR(s).`);
