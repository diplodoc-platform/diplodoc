import {
  approvePr,
  enableAutoMerge,
  findReleasePleasePr,
  getPr,
  listCheckRuns,
  mergePr,
} from './gh.js';
import { classifyChecks, isDependabotConfigCheck } from './wait-ci.js';
import { pollUntil } from './poll.js';

/** First semver in a release-please PR title ("chore(main): release 1.2.3"),
 * or null — the dashboard shows it as "pending" until npm confirms it. */
export function releaseVersionFromTitle(title) {
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(String(title || ''));
  return match ? match[1] : null;
}

const defaultDeps = {
  approvePr,
  enableAutoMerge,
  findReleasePleasePr,
  getPr,
  listCheckRuns,
  mergePr,
  pollUntil,
};

export async function waitForReleasePleaseMerge({
  owner,
  repo,
  token,
  approverToken,
  autoApprove,
  mergeMethod,
  pollIntervalS = 30,
  timeoutMin = 30,
  onReleasePr,
}, deps = defaultDeps) {
  const releasePr = await deps.pollUntil({
    timeoutMin,
    intervalS: pollIntervalS,
    check: () => {
      const pr = deps.findReleasePleasePr(owner, repo, token);
      if (!pr) console.log(`Waiting for release-please PR in ${owner}/${repo}…`);
      return pr || null;
    },
    onTimeout: () => new Error(`release-please PR did not appear in ${owner}/${repo} within ${timeoutMin}m`),
  });

  const prRef = { number: releasePr.number, url: releasePr.url };

  // Surface the release PR on the dashboard as soon as it exists, not only
  // after it merged — the wait below can take up to the manual timeout.
  if (onReleasePr) {
    await onReleasePr({ releasePr: prRef, pendingVersion: releaseVersionFromTitle(releasePr.title) });
  }

  if (autoApprove && approverToken) {
    try {
      deps.approvePr(owner, repo, releasePr.number, approverToken, 'Auto-approved by release train (release-please PR).');
    } catch (err) {
      console.warn(`::warning::Auto-approve release PR failed: ${err.message}`);
    }
  } else {
    console.log(`::notice::Waiting for manual merge of release PR ${owner}/${repo}#${releasePr.number}`);
  }

  try {
    return await deps.pollUntil({
      timeoutMin,
      intervalS: pollIntervalS,
      check: () => {
        const pr = deps.getPr(owner, repo, releasePr.number, token);
        if (pr.state === 'MERGED') return { releasePr: prRef, merged: true };
        if (pr.state === 'CLOSED') {
          throw new Error(`Release PR ${owner}/${repo}#${releasePr.number} was closed without merge`);
        }
        if (!autoApprove || !approverToken || pr.autoMergeRequest || !pr.headRefOid) return null;

        const checks = deps.listCheckRuns(owner, repo, pr.headRefOid, token);
        if (classifyChecks(checks).state !== 'success') return null;

        // Check runs are fetched in full above. Preserve legacy commit statuses
        // too, including external checks such as Internal Check. Unknown rollups
        // fail closed; branch protection remains the final authority on merging.
        if (!Array.isArray(pr.statusCheckRollup) || pr.statusCheckRollup.some(
          (check) => check.__typename !== 'CheckRun' && !(
            check.__typename === 'StatusContext' && check.state === 'SUCCESS'
          ),
        )) {
          return null;
        }

        const pendingConfig = checks.check_runs.some(
          (check) => isDependabotConfigCheck(check) && check.status !== 'completed',
        );
        if (pr.mergeStateStatus === 'UNSTABLE' && pendingConfig) {
          try {
            deps.mergePr(owner, repo, releasePr.number, mergeMethod, token, pr.headRefOid);
          } catch (err) {
            console.warn(`::warning::Protected release PR merge failed: ${err.message}`);
          }
        } else {
          // Re-evaluate after transient API refusals instead of waiting forever
          // for an auto-merge request that GitHub never accepted.
          deps.enableAutoMerge(owner, repo, releasePr.number, mergeMethod, token, pr.headRefOid);
        }

        return null;
      },
      onTimeout: () =>
        new Error(`Release PR ${owner}/${repo}#${releasePr.number} not merged within ${timeoutMin}m`),
    });
  } catch (err) {
    if (!autoApprove && /not merged within/.test(err.message)) {
      return { releasePr: prRef, merged: false, waitingManual: true };
    }
    throw err;
  }
}
