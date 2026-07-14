#!/usr/bin/env node
/**
 * Release train orchestrator — sequential merge / release / bump / CI loop.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { mergePr, whoAmI } from './gh.js';
import { waitForReleasePleaseMerge } from './wait-release-please.js';
import { waitForNpmPackage, readPackageVersionFromRepo } from './wait-npm.js';
import { bumpDownstreamDeps } from './bump-downstream.js';
import { waitForCiGreen } from './wait-ci.js';
import { initState, saveState, updatePackage } from './state.js';
import { publishSummary, logProgress } from './render-summary.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'string', default: 'plan.json' },
    'state-file': { type: 'string', default: 'train-state.json' },
    'status-dir': { type: 'string', default: '.release-train-status' },
  },
});

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}

// The approver MUST be the diplodoc-bot machine user (INFRA_APPROVER_PAT), a
// real member of @diplodoc-platform/team. Do NOT silently fall back to the
// App installation token (GH_TOKEN): that authenticates as diplodoc-app[bot],
// a Bot account which is not a team member / code owner, so its review does not
// satisfy require_code_owner_review and shows up as an "app" approval. If the
// PAT is missing we keep approverToken null and skip auto-approve rather than
// approving under the wrong identity.
const approverToken = process.env.INFRA_APPROVER_PAT || null;
if (approverToken) {
  const approverLogin = whoAmI(approverToken);
  if (approverLogin && approverLogin !== 'diplodoc-app[bot]') {
    console.log(`::notice::Release PRs will be approved as: ${approverLogin}`);
  } else {
    console.warn(
      `::warning::INFRA_APPROVER_PAT resolves to "${approverLogin}" (expected the diplodoc-bot machine user, not the App). Approvals may be attributed incorrectly.`,
    );
  }
} else {
  console.warn(
    '::warning::INFRA_APPROVER_PAT is not set — release PRs will NOT be auto-approved by release train.',
  );
}

const plan = JSON.parse(readFileSync(values.plan, 'utf8'));
const config = loadConfig();
const org = plan.org || config.org;
const defaults = config.defaults;

let state = initState(plan);
const publishedByNpm = {};

function persist() {
  saveState(state, values['state-file']);
  // Overwrites the step-summary file (visible only after the step ends) …
  publishSummary(state, `Release train — ${plan.branchName}`);
  // … and streams the same table to the step log for live progress while
  // the long-running orchestrate step is still executing.
  logProgress(state, `Release train — ${plan.branchName}`);
  writeStatusArtifacts();
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
  const pkgState = state.packages.find((p) => p.repo === repo);
  if (!pkgState?.featurePr) return;

  updatePackage(state, repo, { status: 'waiting_ci' });
  persist();

  const result = await waitForCiGreen({
    owner: org,
    repo,
    featurePr: pkgState.featurePr,
    branchName: plan.branchName,
    token,
    config,
    pollIntervalS: defaults.ci_poll_interval_s || 90,
    timeoutMin: defaults.ci_poll_timeout_min || 360,
    onPoll: ({ ci, snapshots }) => {
      updatePackage(state, repo, { ci, snapshots });
      persist();
    },
  });

  updatePackage(state, repo, {
    ci: result.ci,
    snapshots: result.snapshots,
  });
  persist();
}

async function run() {
  if (plan.dryRun) {
    for (const entry of plan.packages) {
      updatePackage(state, entry.repo, { status: 'queued (dry-run)' });
    }
    persist();
    console.log('Dry run complete — no merges performed.');
    return;
  }

  for (let i = 0; i < plan.packages.length; i++) {
    const entry = plan.packages[i];
    const repo = entry.repo;

    try {
      await waitCiForRepo(repo);

      updatePackage(state, repo, {
        status: 'merging',
        startedAt: state.packages.find((p) => p.repo === repo)?.startedAt || new Date().toISOString(),
      });
      persist();

      mergePr(org, repo, entry.featurePr.number, entry.merge_method || 'rebase', token);
      // Record when the feature PR was merged: any release-please PR we act on
      // must have been refreshed AFTER this instant, otherwise we could grab a
      // stale release PR from a previous release that does not yet include the
      // change we just merged (release-please needs a moment to regenerate it).
      // Subtract a small skew allowance for clock differences between runner
      // and GitHub, so a legitimately-fresh PR is not rejected by rounding.
      const mergedAtMs = Date.now() - (defaults.release_freshness_skew_s ?? 30) * 1000;

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
        freshSinceMs: mergedAtMs,
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

      const downstream = plan.packages.slice(i + 1).map((p) => ({
        repo: p.repo,
        featurePr: state.packages.find((s) => s.repo === p.repo)?.featurePr,
      }));

      if (downstream.length > 0) {
        for (const d of downstream) {
          updatePackage(state, d.repo, { status: 'bumping' });
        }
        persist();

        bumpDownstreamDeps({
          owner: org,
          token,
          // Push the bump commit as diplodoc-bot (PAT), not the App token:
          // the push identity becomes event.sender on the docs-api webhook,
          // and only a real team member passes its membership check.
          pushToken: approverToken,
          branchName: plan.branchName,
          publishedVersions: { ...publishedByNpm },
          targets: downstream,
          updateLockfile: config.capabilities?.update_lockfile?.default !== false,
        });
      }

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
      persist();
      console.error(`::error::${err.message}`);
      process.exit(1);
    }
  }

  publishSummary(state, `Release train — ${plan.branchName} (complete)`);
  console.log('Release train completed successfully.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
