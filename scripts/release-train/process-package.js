/**
 * Per-package pipeline of the release train.
 *
 * Every phase first checks reality on GitHub/npm and only then acts, so the
 * whole pipeline is idempotent: a resumed train continues from whatever a
 * previous (crashed) run or a human already completed — an already merged
 * feature PR, a merged release PR or an already published npm version are
 * skipped instead of failing the train.
 *
 * External effects are injected through `deps` so the pipeline logic is unit
 * testable without a network.
 */

import { getPr, mergePr } from './gh.js';
import { bumpDownstreamDeps } from './bump-downstream.js';
import { waitForCiGreen } from './wait-ci.js';
import { waitForReleasePleaseMerge } from './wait-release-please.js';
import { readPackageVersionFromRepo, waitForNpmPackage } from './wait-npm.js';

export const defaultDeps = {
  getPr,
  mergePr,
  bumpDownstreamDeps,
  waitForCiGreen,
  waitForReleasePleaseMerge,
  readPackageVersionFromRepo,
  waitForNpmPackage,
};

/**
 * @param {Object} ctx - orchestrator context: {org, token, approverToken,
 *   config, defaults, trainId, issue, branchName, targetBranch,
 *   publishedByNpm, updateLockfile, findPackage, updatePackage, persist, now}
 * @param {Object} entry - plan entry: {repo, npm, featurePr, merge_method,
 *   auto_approve_release, ...}
 */
export async function processPackage(ctx, entry, deps = defaultDeps) {
  const repo = entry.repo;
  const pkg = ctx.findPackage(repo);
  const prNumber = pkg?.featurePr?.number || entry.featurePr?.number;
  if (!prNumber) {
    throw new Error(`No feature PR known for ${ctx.org}/${repo}`);
  }

  ctx.updatePackage(repo, { startedAt: pkg?.startedAt || ctx.now() });

  const feature = deps.getPr(ctx.org, repo, prNumber, ctx.token);
  if (feature.state === 'CLOSED') {
    throw new Error(`Feature PR ${ctx.org}/${repo}#${prNumber} was closed without merge`);
  }

  if (feature.state === 'MERGED') {
    console.log(`[${repo}] feature PR #${prNumber} already merged — skipping CI wait and merge`);
  } else {
    ensureBumped(ctx, entry, deps);
    await waitForGreenCi(ctx, entry, deps);
    ctx.updatePackage(repo, { status: 'merging' });
    ctx.persist();
    deps.mergePr(ctx.org, repo, prNumber, entry.merge_method || 'rebase', ctx.token);
  }

  await ensureReleased(ctx, entry, deps);
  await ensurePublished(ctx, entry, deps);

  ctx.updatePackage(repo, { status: 'done', finishedAt: ctx.now() });
  ctx.persist();
}

/**
 * Deferred dependency bump: one commit on the package's feature branch with
 * every version published so far, applied right before the package's turn.
 * In topological order all in-train upstreams have released by that point, so
 * `publishedByNpm` is exactly the accumulated set — one commit, one CI rerun.
 * `bumpDownstreamDeps` is idempotent, so a resume replays this as a no-op.
 */
function ensureBumped(ctx, entry, deps) {
  const pkg = ctx.findPackage(entry.repo);
  if (!pkg?.featurePr?.number) return;
  if (!Object.keys(ctx.publishedByNpm).length) return;

  ctx.updatePackage(entry.repo, { status: 'bumping' });
  ctx.persist();

  const results = deps.bumpDownstreamDeps({
    owner: ctx.org,
    token: ctx.token,
    branchName: ctx.branchName,
    publishedVersions: { ...ctx.publishedByNpm },
    targets: [{ repo: entry.repo, featurePr: pkg.featurePr, branch: pkg.featurePr.headRefName }],
    updateLockfile: ctx.updateLockfile,
    trainId: ctx.trainId,
    issueRef: ctx.issue,
  });

  if (results[0]?.bumped) {
    ctx.updatePackage(entry.repo, { bumpedDeps: { ...ctx.publishedByNpm } });
    ctx.persist();
  }
}

async function waitForGreenCi(ctx, entry, deps) {
  const repo = entry.repo;
  const pkg = ctx.findPackage(repo);

  ctx.updatePackage(repo, { status: 'waiting_ci' });
  ctx.persist();

  const result = await deps.waitForCiGreen({
    owner: ctx.org,
    repo,
    featurePr: pkg.featurePr,
    branchName: pkg.featurePr.headRefName || ctx.branchName,
    token: ctx.token,
    config: ctx.config,
    pollIntervalS: ctx.defaults.ci_poll_interval_s || 90,
    timeoutMin: ctx.defaults.ci_poll_timeout_min || 360,
    onPoll: ({ ci, snapshots, mergeReadiness }) => {
      ctx.updatePackage(repo, { ci, snapshots, mergeReadiness });
      ctx.persist();
    },
  });

  ctx.updatePackage(repo, { ci: result.ci, snapshots: result.snapshots });
  ctx.persist();
}

async function ensureReleased(ctx, entry, deps) {
  const repo = entry.repo;
  const pkg = ctx.findPackage(repo);

  ctx.updatePackage(repo, { status: 'release_pending' });
  ctx.persist();

  // Reconcile a release PR recorded by a previous run before waiting for one:
  // it may have merged after the run died. An open one is found again by the
  // regular wait below.
  const knownNumber = pkg?.releasePr?.number;
  if (knownNumber) {
    const known = deps.getPr(ctx.org, repo, knownNumber, ctx.token);
    if (known.state === 'MERGED') {
      console.log(`[${repo}] release PR #${knownNumber} already merged`);
      return;
    }
    if (known.state === 'CLOSED') {
      throw new Error(`Release PR ${ctx.org}/${repo}#${knownNumber} was closed without merge`);
    }
  }

  const releaseTimeout = entry.auto_approve_release
    ? ctx.defaults.release_poll_timeout_min || 30
    : ctx.defaults.manual_release_timeout_min || 240;

  const rp = await deps.waitForReleasePleaseMerge({
    owner: ctx.org,
    repo,
    token: ctx.token,
    approverToken: ctx.approverToken,
    autoApprove: entry.auto_approve_release,
    mergeMethod: entry.merge_method || 'rebase',
    pollIntervalS: ctx.defaults.release_poll_interval_s || 30,
    timeoutMin: releaseTimeout,
    onReleasePr: ({ releasePr, pendingVersion }) => {
      ctx.updatePackage(repo, { releasePr, pendingVersion });
      ctx.persist();
    },
  });

  ctx.updatePackage(repo, { releasePr: rp.releasePr });

  if (rp.waitingManual) {
    ctx.updatePackage(repo, { status: 'waiting_release_review' });
    ctx.persist();
    throw new Error(
      `Timed out waiting for manual release PR merge: ${ctx.org}/${repo}#${rp.releasePr.number}`,
    );
  }
}

async function ensurePublished(ctx, entry, deps) {
  const repo = entry.repo;

  // The version on the target branch is what the merged release PR set; the
  // npm wait's first probe is immediate, so an already published version
  // (e.g. a manually re-run publish job) is confirmed without extra polling.
  const version = deps.readPackageVersionFromRepo(ctx.org, repo, ctx.targetBranch, ctx.token);
  await deps.waitForNpmPackage(entry.npm, version, ctx.defaults.npm_wait_timeout_min || 15);

  const npmVersion = String(version).replace(/^v/, '');
  ctx.publishedByNpm[entry.npm] = npmVersion;
  ctx.updatePackage(repo, { status: 'released', npmVersion });
  ctx.persist();
}
