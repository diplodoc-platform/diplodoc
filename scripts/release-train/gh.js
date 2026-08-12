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
  prList: 'number,url,title,headRefName,baseRefName,mergeable,reviewDecision,state,isDraft,autoMergeRequest',
  prView:
    'number,url,title,headRefName,baseRefName,isDraft,state,mergeable,reviewDecision,mergedAt,mergeStateStatus,autoMergeRequest,statusCheckRollup,headRefOid',
  runList: 'databaseId,status,conclusion,url,workflowName,headBranch,event',
};

/**
 * Optional GitHub App token manager (app-token.js). When set, tokens it issued
 * are transparently replaced by the current one, so a train outliving the
 * 1-hour installation-token lifetime keeps working. Tokens it did not issue
 * (INFRA_APPROVER_PAT) are passed through untouched.
 */
let tokenManager = null;

export function setTokenManager(manager) {
  tokenManager = manager;
}

function resolveToken(token) {
  if (!tokenManager) return token;
  if (token && !tokenManager.owns(token)) return token;
  return tokenManager.get();
}

const EXPIRED_TOKEN_RE = /HTTP 401|Bad credentials/i;

function isExpiredTokenError(err) {
  const stderr = err?.stderr ? String(err.stderr) : '';
  return EXPIRED_TOKEN_RE.test(`${err?.message || ''}\n${stderr}`);
}

function runGh(args, token, options) {
  const env = { ...process.env };
  if (token) env.GH_TOKEN = token;
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env,
    input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

/**
 * Run `gh` with an argument array (no shell involved).
 * @param {string[]} args
 * @param {string} [token]
 * @param {{input?: string}} [options] - stdin payload, used for `gh api --input -`
 *   so large/multiline JSON bodies never travel through argv.
 */
export function ghRaw(args, token, options = {}) {
  const resolved = resolveToken(token);
  try {
    return runGh(args, resolved, options);
  } catch (err) {
    // A token can expire mid-call (or mid-wait); re-mint once and retry before
    // letting the failure reach the train.
    if (!tokenManager || !tokenManager.owns(resolved) || !isExpiredTokenError(err)) throw err;
    console.warn('::warning::GitHub token rejected — refreshing the App installation token');
    return runGh(args, tokenManager.refresh(), options);
  }
}

/**
 * Call the GitHub REST API through `gh api` and parse the JSON response.
 * @param {string} path - API path, e.g. `repos/owner/repo/issues/1`
 * @param {{token?: string, method?: string, body?: object, paginate?: boolean}} [options]
 */
export function ghApi(path, options = {}) {
  const { token, method = 'GET', body, paginate = false } = options;
  const args = ['api', path];
  if (method !== 'GET') args.push('-X', method);
  // Bare `--paginate` concatenates the pages into `[...][...]`, which is not
  // valid JSON; `--slurp` wraps them into a single JSON value instead.
  if (paginate) args.push('--paginate', '--slurp');
  let input;
  if (body !== undefined) {
    args.push('--input', '-');
    input = JSON.stringify(body);
  }
  const out = ghRaw(args, token, { input });
  if (!out) return null;
  const parsed = JSON.parse(out);
  if (paginate && Array.isArray(parsed) && parsed.every(Array.isArray)) return parsed.flat();
  return parsed;
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

export function dispatchWorkflow(owner, repo, workflowFile, inputs, token, ref) {
  const inputArgs = Object.entries(inputs || {}).flatMap(([k, v]) => ['-f', `${k}=${String(v)}`]);
  const refArgs = ref ? ['--ref', ref] : [];
  ghRaw(
    ['workflow', 'run', workflowFile, '--repo', `${owner}/${repo}`, ...refArgs, ...inputArgs],
    token,
  );
}

/* ------------------------------------------------------------------ *
 * Issues, labels and comments — used by the tracking issue lifecycle. *
 * ------------------------------------------------------------------ */

/** Issues carrying `label`. The issues endpoint also returns pull requests,
 * which are never tracking issues, so they are filtered out here. */
export function listIssuesByLabel(owner, repo, label, token, state = 'all') {
  const path = `repos/${owner}/${repo}/issues?labels=${encodeURIComponent(label)}&state=${state}&per_page=100`;
  const issues = ghApi(path, { token }) || [];
  return issues.filter((issue) => !issue.pull_request);
}

export function getIssue(owner, repo, number, token) {
  return ghApi(`repos/${owner}/${repo}/issues/${number}`, { token });
}

export function createIssue(owner, repo, { title, body, labels }, token) {
  return ghApi(`repos/${owner}/${repo}/issues`, {
    token,
    method: 'POST',
    body: { title, body, labels: labels || [] },
  });
}

export function updateIssue(owner, repo, number, patch, token) {
  return ghApi(`repos/${owner}/${repo}/issues/${number}`, {
    token,
    method: 'PATCH',
    body: patch,
  });
}

/** Create the label if it does not exist yet. Concurrent trains may race here,
 * so an "already exists" failure is not an error. */
export function ensureLabel(owner, repo, name, { color = 'ededed', description = '' }, token) {
  try {
    ghApi(`repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, { token });
    return false;
  } catch {
    try {
      ghApi(`repos/${owner}/${repo}/labels`, {
        token,
        method: 'POST',
        body: { name, color, description },
      });
      return true;
    } catch (err) {
      console.warn(`::warning::Could not create label ${name} in ${owner}/${repo}: ${err.message}`);
      return false;
    }
  }
}

/** Comments of an issue OR a pull request — both live on the issues endpoint. */
export function listIssueComments(owner, repo, number, token) {
  return ghApi(`repos/${owner}/${repo}/issues/${number}/comments?per_page=100`, {
    token,
    paginate: true,
  }) || [];
}

export function createIssueComment(owner, repo, number, body, token) {
  return ghApi(`repos/${owner}/${repo}/issues/${number}/comments`, {
    token,
    method: 'POST',
    body: { body },
  });
}

export function updateIssueComment(owner, repo, commentId, body, token) {
  return ghApi(`repos/${owner}/${repo}/issues/comments/${commentId}`, {
    token,
    method: 'PATCH',
    body: { body },
  });
}

export function addCommentReaction(owner, repo, commentId, content, token) {
  try {
    return ghApi(`repos/${owner}/${repo}/issues/comments/${commentId}/reactions`, {
      token,
      method: 'POST',
      body: { content },
    });
  } catch (err) {
    console.warn(`::warning::Could not react to comment ${commentId}: ${err.message}`);
    return null;
  }
}

/**
 * Active membership of `username` in `org/teamSlug`. Any API failure (missing
 * scope, unknown team, no membership) is reported as "not a member" — this
 * gates privileged commands, so it must fail closed.
 */
export function isTeamMember(org, teamSlug, username, token) {
  try {
    const membership = ghApi(
      `orgs/${org}/teams/${teamSlug}/memberships/${encodeURIComponent(username)}`,
      { token },
    );
    return membership?.state === 'active';
  } catch {
    return false;
  }
}

export function getDefaultBranch(owner, repo, token) {
  return ghApi(`repos/${owner}/${repo}`, { token })?.default_branch || null;
}

/* ------------------------------------------- *
 * Git refs — deterministic drift branches.     *
 * ------------------------------------------- */

export function getBranchSha(owner, repo, branch, token) {
  try {
    return ghApi(`repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, { token })
      ?.object?.sha;
  } catch {
    return null;
  }
}

/**
 * Create `branch` at the tip of `fromBranch` when it does not exist yet.
 * An existing branch is left untouched — reruns must be idempotent and must
 * not discard commits already pushed to it.
 * @returns {{created: boolean, sha: string|null}}
 */
export function ensureBranch(owner, repo, branch, fromBranch, token) {
  const existing = getBranchSha(owner, repo, branch, token);
  if (existing) return { created: false, sha: existing };

  const baseSha = getBranchSha(owner, repo, fromBranch, token);
  if (!baseSha) throw new Error(`Base branch ${fromBranch} not found in ${owner}/${repo}`);

  ghApi(`repos/${owner}/${repo}/git/refs`, {
    token,
    method: 'POST',
    body: { ref: `refs/heads/${branch}`, sha: baseSha },
  });
  return { created: true, sha: baseSha };
}

export function listCheckRuns(owner, repo, ref, token) {
  try {
    const pages = ghApi(`repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`, {
      token,
      paginate: true,
    });
    // `--slurp` wraps the object pages into an array; merge their check_runs
    // so re-runs on visual-test repos are not truncated at 100 entries.
    const list = Array.isArray(pages) ? pages : [pages];
    return { check_runs: list.flatMap((page) => page?.check_runs || []) };
  } catch {
    return { check_runs: [] };
  }
}

export function findReleasePleasePr(owner, repo, token) {
  const prs = ghJson(
    ['pr', 'list', '--repo', `${owner}/${repo}`, '--author', 'yc-ui-bot', '--state', 'open', '--limit', '30'],
    token,
    'prList',
  );
  return (prs || []).find((p) => p.headRefName?.startsWith('release-please--')) || null;
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
