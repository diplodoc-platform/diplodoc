/**
 * Tracking issue lifecycle for the release train.
 *
 * The issue in `diplodoc-platform/diplodoc` is both the live dashboard
 * (`$GITHUB_STEP_SUMMARY` only renders after a step finishes, which is useless
 * for a train that runs for hours) and the durable store of train state: the
 * hidden `RT-STATE` block is what a resume run reads back.
 */

import {
  createIssue,
  createIssueComment,
  ensureLabel,
  listIssueComments,
  listIssuesByLabel,
  updateIssue,
  updateIssueComment,
} from './gh.js';
import { mermaidBlock } from './render-graph.js';
import { renderSummaryTable } from './render-summary.js';

export const RT_STATE_BEGIN = '<!-- RT-STATE';
export const RT_STATE_END = 'RT-STATE -->';

export const DRIFT_LABEL = 'release-train-drift';

/** Train ids reach `gh` argument arrays, git refs and label names — keep the
 * charset boring. */
const TRAIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const COMMANDS_HINT =
  '_Commands: `/rt resume` to restart this train, `/rt resume prs=cli#123` to resume and add PRs._';

export const DRIFT_COMMANDS_HINT =
  '_Commands: `/rt start` to create dependency update PRs and run this train._';

export function normalizeTrainId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!TRAIN_ID_RE.test(raw)) {
    throw new Error(
      `Invalid train_id ${JSON.stringify(raw)} — allowed: letters, digits, dot, dash, underscore (max 64)`,
    );
  }
  return raw;
}

/** Manual `train_id` wins; otherwise derive `rt-<run number>`. */
export function resolveTrainId(inputTrainId, runNumberOrId) {
  const manual = normalizeTrainId(inputTrainId);
  if (manual) return manual;
  const generated = String(runNumberOrId ?? '').trim();
  if (!generated) {
    throw new Error('Cannot generate train_id: no run number provided and train_id input is empty');
  }
  return normalizeTrainId(`rt-${generated}`);
}

export function trainLabel(trainId) {
  return `release-train:${trainId}`;
}

export function trainIssueTitle(trainId) {
  return `Release train: ${trainId}`;
}

export function backlinkMarker(trainId) {
  return `<!-- release-train-link:${trainId} -->`;
}

/**
 * Escape HTML comment delimiters inside the serialized state so an arbitrary
 * string (an error message, a PR title) can never close the hidden block early.
 * `\u003c` / `\u003e` are valid JSON string escapes, so parsing round-trips.
 */
function escapeCommentMarkers(json) {
  return json.replaceAll('-->', '--\\u003e').replaceAll('<!--', '\\u003c!--');
}

/**
 * The visible part of the body is assembled from untrusted strings (PR titles,
 * error messages, drift rows). `parseTrainState` reads the *first* RT-STATE
 * block, so a crafted string could otherwise smuggle in a fake state that a
 * resume would trust. HTML-escaping the delimiters keeps the text readable
 * while leaving exactly one real hidden block in the body.
 *
 * Applied per block, not to the whole body: mermaid blocks are machine
 * generated (render-graph.js strips `<` and `>` from every label) and their
 * `-->` edges must survive verbatim or GitHub's mermaid renderer fails with
 * "Lexical error … --&gt;".
 */
function neutralizeCommentMarkers(text) {
  return text.replaceAll('<!--', '&lt;!--').replaceAll('-->', '--&gt;');
}

/**
 * Defense in depth for trusted (machine-generated) blocks: a forged RT-STATE
 * needs the `<!-- RT-STATE` begin marker, so escaping only the comment opener
 * is enough — a bare `-->` before the real block cannot open anything.
 */
function neutralizeCommentOpeners(text) {
  return text.replaceAll('<!--', '&lt;!--');
}

export function renderStateBlock(rtState) {
  const json = escapeCommentMarkers(JSON.stringify(rtState, null, 2));
  return `${RT_STATE_BEGIN}\n${json}\n${RT_STATE_END}`;
}

/** Extract the hidden state payload from an issue body. Returns null when the
 * block is missing or unparsable — callers then treat the train as fresh. */
export function parseTrainState(body) {
  if (!body) return null;
  const start = body.indexOf(RT_STATE_BEGIN);
  if (start === -1) return null;
  const end = body.indexOf(RT_STATE_END, start + RT_STATE_BEGIN.length);
  if (end === -1) return null;
  const json = body.slice(start + RT_STATE_BEGIN.length, end).trim();
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (err) {
    console.warn(`::warning::Tracking issue RT-STATE is not valid JSON: ${err.message}`);
    return null;
  }
}

export function renderIssueBody({
  trainId,
  mode = 'feature-prs',
  status = 'running',
  state = null,
  workflow = null,
  graph = '',
  diagnostics = null,
  sections = [],
  hint = COMMANDS_HINT,
  rtState = null,
  title = null,
}) {
  // Untrusted blocks get full delimiter neutralization; trusted (machine
  // generated) mermaid blocks only escape the comment opener so their `-->`
  // edges keep rendering.
  const blocks = [];
  const push = (text, { trusted = false } = {}) => {
    if (!text) return;
    blocks.push(trusted ? neutralizeCommentOpeners(text) : neutralizeCommentMarkers(text));
  };

  if (state) {
    push(renderSummaryTable(state, title || trainIssueTitle(trainId)));
  } else if (title) {
    push(`## ${title}`);
  }

  const meta = [`**Train:** \`${trainId}\``, `**Mode:** \`${mode}\``, `**Status:** \`${status}\``];
  if (workflow?.runUrl) meta.push(`**Run:** [workflow](${workflow.runUrl})`);
  push(meta.join(' · '));

  const progress = mermaidBlock(graph);
  if (progress) push(['### Progress', '', progress].join('\n'), { trusted: true });

  if (diagnostics) {
    const parts = ['### Diagnostics', ''];
    if (diagnostics.message) parts.push(neutralizeCommentMarkers(diagnostics.message), '');
    const conflictGraph = mermaidBlock(diagnostics.graph);
    if (conflictGraph) parts.push(neutralizeCommentOpeners(conflictGraph));
    blocks.push(parts.join('\n').trimEnd());
  }

  for (const section of sections) {
    if (!section?.body) continue;
    push(section.heading ? `### ${section.heading}\n\n${section.body}` : section.body);
  }

  if (hint) push(`---\n${hint}`);

  const visible = blocks.filter(Boolean).join('\n\n');
  const parts = rtState ? [visible, renderStateBlock(rtState)] : [visible];

  return parts.join('\n\n') + '\n';
}

export function ensureTrainLabel({ owner, repo, trainId, token }) {
  return ensureLabel(
    owner,
    repo,
    trainLabel(trainId),
    { color: '0e8a16', description: `Release train ${trainId}` },
    token,
  );
}

export function findTrainIssue({ owner, repo, trainId, token }) {
  const label = trainLabel(trainId);
  const issues = listIssuesByLabel(owner, repo, label, token, 'all');
  if (!issues.length) return null;
  // Oldest issue wins: if a label somehow ended up on several issues, the
  // first one created for this train is the canonical dashboard.
  const issue = issues.sort((a, b) => a.number - b.number)[0];
  return { number: issue.number, url: issue.html_url, body: issue.body || '', state: issue.state };
}

/**
 * Find the train's issue or create it. A closed issue is reopened, because a
 * train only reaches `prepare` again when there is more work to do.
 */
export function ensureTrainIssue({ owner, repo, trainId, token, extraLabels = [], reopen = true }) {
  ensureTrainLabel({ owner, repo, trainId, token });
  for (const extra of extraLabels) {
    ensureLabel(owner, repo, extra, { color: 'fbca04', description: 'Release train' }, token);
  }

  const existing = findTrainIssue({ owner, repo, trainId, token });
  if (existing) {
    if (reopen && existing.state === 'closed') {
      updateIssue(owner, repo, existing.number, { state: 'open' }, token);
      existing.state = 'open';
    }
    return { ...existing, created: false };
  }

  const created = createIssue(
    owner,
    repo,
    {
      title: trainIssueTitle(trainId),
      body: `## ${trainIssueTitle(trainId)}\n\nPreparing release train…\n`,
      labels: [trainLabel(trainId), ...extraLabels],
    },
    token,
  );

  return {
    number: created.number,
    url: created.html_url,
    body: created.body || '',
    state: created.state || 'open',
    created: true,
  };
}

export function updateTrainIssue({ owner, repo, issueNumber, body, token }) {
  return updateIssue(owner, repo, issueNumber, { body }, token);
}

export function closeTrainIssue({ owner, repo, issueNumber, token }) {
  return updateIssue(owner, repo, issueNumber, { state: 'closed', state_reason: 'completed' }, token);
}

export function commentTrainIssue({ owner, repo, issueNumber, body, token }) {
  return createIssueComment(owner, repo, issueNumber, body, token);
}

export function renderBacklinkBody({ trainId, issueUrl }) {
  return [
    backlinkMarker(trainId),
    `🚂 This PR is part of release train \`${trainId}\`.`,
    `Live dashboard: ${issueUrl}`,
  ].join('\n');
}

/**
 * Post the tracking-issue backlink into a feature PR exactly once. Restarts
 * reuse the existing comment (matched by the hidden marker) instead of piling
 * up duplicates.
 */
export function ensureBacklinkComment({ owner, repo, prNumber, trainId, issueUrl, token }) {
  const marker = backlinkMarker(trainId);
  const body = renderBacklinkBody({ trainId, issueUrl });

  let comments = [];
  try {
    comments = listIssueComments(owner, repo, prNumber, token);
  } catch (err) {
    console.warn(`::warning::Could not list comments on ${owner}/${repo}#${prNumber}: ${err.message}`);
  }

  const existing = comments.find((c) => (c.body || '').includes(marker));
  if (existing) {
    if ((existing.body || '').trim() === body.trim()) return { action: 'unchanged' };
    updateIssueComment(owner, repo, existing.id, body, token);
    return { action: 'updated' };
  }

  createIssueComment(owner, repo, prNumber, body, token);
  return { action: 'created' };
}
