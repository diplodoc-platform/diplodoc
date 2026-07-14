/**
 * GitHub CLI helpers for release train.
 *
 * All shell-outs use execFileSync with argument arrays (never a single
 * interpolated string executed through /bin/sh), so values coming from
 * PR titles, branch names, commit messages, etc. cannot be interpreted as
 * shell metacharacters.
 */

import { execFileSync } from 'node:child_process';

/** Known bot accounts whose approvals may be safely dismissed on new pushes
 * and which must never count as "human approval". Extend via
 * release-train.yml `capabilities.known_bots` — see config.js. */
export const DEFAULT_BOT_LOGINS = new Set([
  'yc-ui-bot',
  'diplodoc-bot',
  'github-actions',
  'github-actions[bot]',
  'dependabot',
  'dependabot[bot]',
]);

/**
 * Exact-match (case-insensitive) bot detection — deliberately NOT a fuzzy
 * substring/regex match, so a human login that merely contains "bot"
 * (e.g. "IgorBotov") is never misclassified.
 */
export function isBotLogin(login, extraBotLogins = []) {
  if (!login) return false;
  const normalized = String(login).toLowerCase();
  if (DEFAULT_BOT_LOGINS.has(normalized)) return true;
  return extraBotLogins.some((b) => String(b).toLowerCase() === normalized);
}

const JSON_FIELDS = {
  prList:
    'number,url,title,headRefName,baseRefName,mergeable,reviewDecision,state,isDraft,autoMergeRequest,updatedAt,createdAt',
  prView:
    'number,url,title,headRefName,state,mergeable,reviewDecision,mergedAt,mergeStateStatus,autoMergeRequest,statusCheckRollup,headRefOid,updatedAt',
  runList: 'databaseId,status,conclusion,url,workflowName,headBranch,event',
};

/**
 * Run `gh` with an argument array (no shell involved).
 * @param {string[]} args
 * @param {string} [token]
 */
export function ghRaw(args, token) {
  const env = { ...process.env };
  if (token) env.GH_TOKEN = token;
  return execFileSync('gh', args, { encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * Run `gh ... --json <fields>` and parse the result.
 * @param {string[]} args
 * @param {string} token
 * @param {'prList'|'prView'|'runList'} kind - explicit field set selector
 *   (replaces the previous substring-sniffing of the command string).
 */
export function ghJson(args, token, kind = 'prView') {
  const fields = JSON_FIELDS[kind] || JSON_FIELDS.prView;
  const out = ghRaw([...args, '--json', fields], token);
  return out ? JSON.parse(out) : null;
}

export function findOpenPrByBranch(owner, repo, branch, token) {
  const prs = ghJson(
    ['pr', 'list', '--repo', `${owner}/${repo}`, '--head', branch, '--state', 'open'],
    token,
    'prList',
  );
  return prs?.[0] || null;
}

export function getPr(owner, repo, number, token) {
  return ghJson(['pr', 'view', String(number), '--repo', `${owner}/${repo}`], token, 'prView');
}

export function mergePr(owner, repo, number, method, token) {
  ghRaw(['pr', 'merge', String(number), '--repo', `${owner}/${repo}`, `--${method}`], token);
}

export function enableAutoMerge(owner, repo, number, method, token) {
  try {
    ghRaw(['pr', 'merge', String(number), '--repo', `${owner}/${repo}`, '--auto', `--${method}`], token);
    return true;
  } catch (err) {
    console.warn(`::warning::Enable auto-merge failed for ${owner}/${repo}#${number}: ${err.message}`);
    return false;
  }
}

export function approvePr(owner, repo, number, token, body = 'Approved by release train.') {
  ghRaw(['pr', 'review', String(number), '--repo', `${owner}/${repo}`, '--approve', '--body', body], token);
}

/**
 * Resolve the GitHub login that a token authenticates as (via `GET /user`).
 * Used to verify the approver token is the diplodoc-bot machine user and not,
 * e.g., the GitHub App installation token (which authenticates as
 * `diplodoc-app[bot]` — a Bot account that must never be the approver).
 * Returns null if the identity cannot be resolved.
 */
export function whoAmI(token) {
  try {
    return ghRaw(['api', 'user', '--jq', '.login'], token) || null;
  } catch (err) {
    console.warn(`::warning::Could not resolve token identity: ${err.message}`);
    return null;
  }
}

export function listReviews(owner, repo, number, token) {
  try {
    return JSON.parse(ghRaw(['api', `repos/${owner}/${repo}/pulls/${number}/reviews`], token));
  } catch (err) {
    console.warn(`::warning::Could not list reviews on ${owner}/${repo}#${number}: ${err.message}`);
    return [];
  }
}

export function dismissBotApprovals(owner, repo, number, token, message, extraBotLogins = []) {
  const reviews = listReviews(owner, repo, number, token);

  for (const review of reviews) {
    if (review.state !== 'APPROVED') continue;
    if (!isBotLogin(review.user?.login, extraBotLogins)) continue;
    try {
      ghRaw(
        [
          'api',
          `repos/${owner}/${repo}/pulls/${number}/reviews/${review.id}/dismissals`,
          '-f',
          `message=${message}`,
        ],
        token,
      );
    } catch (err) {
      console.warn(`::warning::Dismiss review ${review.id} failed: ${err.message}`);
    }
  }
}

export function commentPr(owner, repo, number, body, token) {
  ghRaw(['pr', 'comment', String(number), '--repo', `${owner}/${repo}`, '--body', body], token);
}

export function dispatchWorkflow(owner, repo, workflowFile, inputs, token) {
  const inputArgs = Object.entries(inputs || {}).flatMap(([k, v]) => ['-f', `${k}=${String(v)}`]);
  ghRaw(['workflow', 'run', workflowFile, '--repo', `${owner}/${repo}`, ...inputArgs], token);
}

export function listCheckRuns(owner, repo, ref, token) {
  try {
    return JSON.parse(
      ghRaw(['api', `repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`], token),
    );
  } catch {
    return { check_runs: [] };
  }
}

/**
 * Find the open release-please PR authored by yc-ui-bot.
 *
 * `notBeforeMs` guards against a race: after we merge a feature PR, an OLD
 * release-please PR may still be open (from a previous release) while
 * release-please has not yet regenerated it to include our just-merged change.
 * Returning that stale PR would release the wrong content. When notBeforeMs is
 * provided, only accept a release PR whose `updatedAt` is at/after that instant
 * (i.e. release-please has touched it since our merge). Returns null otherwise,
 * so the caller keeps polling until the PR is refreshed (or newly created).
 */
export function findReleasePleasePr(owner, repo, token, notBeforeMs = 0) {
  const prs = ghJson(
    ['pr', 'list', '--repo', `${owner}/${repo}`, '--author', 'yc-ui-bot', '--state', 'open', '--limit', '30'],
    token,
    'prList',
  );
  const candidates = (prs || []).filter((p) => p.headRefName?.startsWith('release-please--'));
  if (!notBeforeMs) return candidates[0] || null;
  return (
    candidates.find((p) => {
      const updated = p.updatedAt ? Date.parse(p.updatedAt) : 0;
      return updated >= notBeforeMs;
    }) || null
  );
}

export function getLatestWorkflowRun(owner, repo, workflowFile, branch, token) {
  const runs = ghJson(
    ['run', 'list', '--repo', `${owner}/${repo}`, '--workflow', workflowFile, '--branch', branch, '--limit', '5'],
    token,
    'runList',
  );
  return runs?.[0] || null;
}

export { waitMs } from './poll.js';
