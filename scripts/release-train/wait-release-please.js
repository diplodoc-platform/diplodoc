import { approvePr, enableAutoMerge, findReleasePleasePr, getPr } from './gh.js';
import { pollUntil } from './poll.js';

/** First semver in a release-please PR title ("chore(main): release 1.2.3"),
 * or null — the dashboard shows it as "pending" until npm confirms it. */
export function releaseVersionFromTitle(title) {
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(String(title || ''));
  return match ? match[1] : null;
}

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
}) {
  const releasePr = await pollUntil({
    timeoutMin,
    intervalS: pollIntervalS,
    check: () => {
      const pr = findReleasePleasePr(owner, repo, token);
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
