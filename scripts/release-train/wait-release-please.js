import { approvePr, enableAutoMerge, findReleasePleasePr, getPr } from './gh.js';
import { pollUntil } from './poll.js';

export async function waitForReleasePleaseMerge({
  owner,
  repo,
  token,
  approverToken,
  autoApprove,
  mergeMethod,
  pollIntervalS = 30,
  timeoutMin = 30,
  // Only accept a release-please PR refreshed at/after this instant (ms epoch).
  // Prevents grabbing a stale release PR that predates our feature merge and
  // does not yet contain the just-merged change. Defaults to 0 (any PR).
  freshSinceMs = 0,
}) {
  const releasePr = await pollUntil({
    timeoutMin,
    intervalS: pollIntervalS,
    check: () => {
      const pr = findReleasePleasePr(owner, repo, token, freshSinceMs);
      if (!pr) {
        console.log(
          freshSinceMs
            ? `Waiting for release-please PR in ${owner}/${repo} to be refreshed with the merged change…`
            : `Waiting for release-please PR in ${owner}/${repo}…`,
        );
      }
      return pr || null;
    },
    onTimeout: () =>
      new Error(
        `release-please PR did not appear (or was not refreshed) in ${owner}/${repo} within ${timeoutMin}m`,
      ),
  });

  const prRef = { number: releasePr.number, url: releasePr.url };

  if (autoApprove && approverToken) {
    try {
      approvePr(owner, repo, releasePr.number, approverToken, 'Auto-approved by release train (release-please PR).');
    } catch (err) {
      console.warn(`::warning::Auto-approve release PR failed: ${err.message}`);
    }
    enableAutoMerge(owner, repo, releasePr.number, mergeMethod, token);
  } else {
    console.log(`::notice::Waiting for manual merge of release PR ${owner}/${repo}#${releasePr.number}`);
  }

  try {
    return await pollUntil({
      timeoutMin,
      intervalS: pollIntervalS,
      check: () => {
        const pr = getPr(owner, repo, releasePr.number, token);
        if (pr.state === 'MERGED') return { releasePr: prRef, merged: true };
        if (pr.state === 'CLOSED') {
          throw new Error(`Release PR ${owner}/${repo}#${releasePr.number} was closed without merge`);
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
