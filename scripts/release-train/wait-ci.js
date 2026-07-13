import {
  commentPr,
  dismissBotApprovals,
  dispatchWorkflow,
  getLatestWorkflowRun,
  getPr,
  isBotLogin,
  listCheckRuns,
  listReviews,
} from './gh.js';
import { pollUntil, waitMs } from './poll.js';
import { knownBotLogins, snapshotFailurePatterns, snapshotWorkflowForRepo } from './config.js';

const SKIP_CHECK_RE = /^(auto-approve|release-please|dependabot|update dependenc|distribute|publish|sonarcloud|release train)/i;

function classifyChecks(checkRuns) {
  const relevant = (checkRuns.check_runs || []).filter(
    (r) => r.name && !SKIP_CHECK_RE.test(r.name),
  );
  if (relevant.length === 0) {
    return { state: 'pending', failing: null };
  }
  if (relevant.some((r) => r.status !== 'completed')) {
    return { state: 'pending', failing: null };
  }
  const failed = relevant.find((r) => r.conclusion === 'failure' || r.conclusion === 'cancelled');
  if (failed) {
    return {
      state: 'failure',
      failing: { name: failed.name, url: failed.details_url || failed.html_url },
    };
  }
  if (
    relevant.every(
      (r) =>
        r.conclusion === 'success' ||
        r.conclusion === 'skipped' ||
        r.conclusion === 'neutral',
    )
  ) {
    return { state: 'success', failing: null };
  }
  return { state: 'pending', failing: null };
}

function isSnapshotFailure(failingName, patterns) {
  if (!failingName) return false;
  const lower = failingName.toLowerCase();
  return patterns.some((p) => lower.includes(p.toLowerCase()));
}

async function trySnapshotFix({
  owner,
  repo,
  featurePr,
  branchName,
  token,
  config,
  snapshotState,
}) {
  const workflowFile = snapshotWorkflowForRepo(config, repo);
  if (!workflowFile) return { fixed: false, snapshotState };

  snapshotState.state = 'running';
  try {
    dispatchWorkflow(owner, repo, workflowFile, { pr_number: String(featurePr.number) }, token);
  } catch (err) {
    snapshotState.state = 'failed';
    snapshotState.message = err.message;
    return { fixed: false, snapshotState };
  }

  await waitMs(5000);

  try {
    const run = await pollUntil({
      timeoutMin: 30,
      intervalS: 15,
      check: () => {
        const r = getLatestWorkflowRun(owner, repo, workflowFile, branchName, token);
        return r?.status === 'completed' ? r : null;
      },
      onTimeout: () => new Error('Snapshot workflow timed out'),
    });

    snapshotState.url = run.url;
    if (run.conclusion === 'success') {
      snapshotState.state = 'updated';
      snapshotState.message = 'Bot updated snapshots/screenshots';
      commentPr(
        owner,
        repo,
        featurePr.number,
        '📸 Release train triggered snapshot update. Please review the new snapshots/screenshots before re-approval.',
        token,
      );
      return { fixed: true, snapshotState, needsReapproval: true };
    }
    snapshotState.state = 'failed';
    snapshotState.message = `Workflow conclusion: ${run.conclusion}`;
    return { fixed: false, snapshotState };
  } catch (err) {
    snapshotState.state = 'failed';
    snapshotState.message = err.message;
    return { fixed: false, snapshotState };
  }
}

/**
 * Poll CI on feature PR until green. On snapshot-like failures, dispatch fix workflow.
 */
export async function waitForCiGreen({
  owner,
  repo,
  featurePr,
  branchName,
  token,
  config,
  pollIntervalS = 90,
  timeoutMin = 360,
  onPoll,
}) {
  const patterns = snapshotFailurePatterns(config);
  const extraBotLogins = knownBotLogins(config);
  const deadline = Date.now() + timeoutMin * 60 * 1000;
  let snapshotAttempted = false;
  const snapshots = { state: 'none', url: null, message: null };
  let needsReapproval = false;

  while (Date.now() < deadline) {
    // Single PR fetch per iteration — headRefOid, statusCheckRollup and
    // autoMergeRequest all come from the same `gh pr view` call now.
    const prMeta = getPr(owner, repo, featurePr.number, token);
    const ref = prMeta.headRefOid;
    const checkData = listCheckRuns(owner, repo, ref, token);
    const ci = classifyChecks(checkData);

    if (onPoll) {
      await onPoll({
        ci: needsReapproval
          ? {
              state: 'waiting_review',
              url: ci.failing?.url,
              failingCheck: ci.failing?.name,
            }
          : {
              state: ci.state,
              url: ci.failing?.url,
              failingCheck: ci.failing?.name,
            },
        snapshots,
      });
    }

    if (needsReapproval) {
      const reviews = listReviews(owner, repo, featurePr.number, token);
      const hasHumanApproval = reviews.some(
        (r) => r.state === 'APPROVED' && !isBotLogin(r.user?.login, extraBotLogins),
      );
      if (hasHumanApproval && ci.state === 'success') {
        return { ci: { state: 'success' }, snapshots };
      }
      await waitMs(pollIntervalS * 1000);
      continue;
    }

    if (ci.state === 'success') {
      return { ci: { state: 'success' }, snapshots };
    }

    if (
      ci.state === 'failure' &&
      !snapshotAttempted &&
      isSnapshotFailure(ci.failing?.name, patterns)
    ) {
      snapshotAttempted = true;
      const autoMerge = prMeta.autoMergeRequest?.enabled;
      const fix = await trySnapshotFix({
        owner,
        repo,
        featurePr,
        branchName,
        token,
        config,
        snapshotState: snapshots,
      });
      Object.assign(snapshots, fix.snapshotState);
      if (fix.fixed) {
        if (autoMerge) {
          dismissBotApprovals(
            owner,
            repo,
            featurePr.number,
            token,
            'Release train updated snapshots — re-approval required before merge.',
            extraBotLogins,
          );
          needsReapproval = true;
        }
        await waitMs(pollIntervalS * 1000);
        continue;
      }
    }

    await waitMs(pollIntervalS * 1000);
  }

  throw new Error(`CI did not pass for ${owner}/${repo}#${featurePr.number} within ${timeoutMin}m`);
}
