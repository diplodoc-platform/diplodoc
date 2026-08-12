/**
 * Markdown summary table for release train (GITHUB_STEP_SUMMARY).
 */

import { appendFileSync, writeFileSync } from 'node:fs';

function fmtSnapshots(snap) {
  if (!snap || snap.state === 'none') return '—';
  if (snap.state === 'running') return `⏳ running${snap.url ? ` ([run](${snap.url}))` : ''}`;
  if (snap.state === 'updated') {
    return `📸 updated${snap.url ? ` ([details](${snap.url}))` : ''}${snap.message ? `<br>${snap.message}` : ''}`;
  }
  if (snap.state === 'failed') return `📸 failed${snap.url ? ` ([logs](${snap.url}))` : ''}`;
  return snap.state;
}

function fmtCi(ci) {
  if (!ci) return '—';
  if (ci.state === 'success') return '✅';
  if (ci.state === 'pending') return '⏳ pending';
  if (ci.state === 'waiting_review') return '⏸ re-approval required';
  if (ci.state === 'failure') {
    const link = ci.url ? `❌ [${ci.failingCheck || 'check'}](${ci.url})` : '❌';
    return ci.stillRunning ? `${link} (${ci.stillRunning} still running)` : link;
  }
  return ci.state;
}

function fmtPr(pr) {
  if (!pr) return '—';
  return `[#${pr.number}](${pr.url})`;
}

/** `mergeStateStatus` values that mean "nothing left but pressing merge". */
const MERGE_READY = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);

/**
 * Merge-readiness flag next to the feature PR. Maps GitHub's enums to fixed
 * strings only, so untrusted API values never reach the markdown verbatim.
 */
export function fmtMergeReadiness(readiness) {
  const status = readiness?.mergeStateStatus;
  if (!status || status === 'UNKNOWN') return '';
  if (MERGE_READY.has(status)) return '✓';
  if (status === 'DIRTY') return '✗ conflicts';
  if (status === 'BEHIND') return '✗ behind base';
  if (status === 'DRAFT') return '✗ draft';
  // BLOCKED: name the reason when the review decision explains it.
  if (readiness.reviewDecision === 'REVIEW_REQUIRED') return '✗ review required';
  if (readiness.reviewDecision === 'CHANGES_REQUESTED') return '✗ changes requested';
  return '✗ blocked';
}

export function fmtFeaturePr(pr, readiness) {
  if (!pr) return '—';
  const flag = fmtMergeReadiness(readiness);
  return flag ? `${fmtPr(pr)} ${flag}` : fmtPr(pr);
}

/** npm cell: the published version, or the release PR's version as pending. */
export function fmtNpmVersion(pkg) {
  if (pkg.npmVersion) return pkg.npmVersion;
  if (pkg.pendingVersion) return `${pkg.pendingVersion} (pending)`;
  return '—';
}

/**
 * Status cell. A package waiting for a human shows the time left in its grace
 * window; the deadline lives in state, so the countdown moves on every persist
 * without a timer of its own.
 */
export function fmtStatus(pkg, now = Date.now()) {
  const status = pkg.error ? `❌ ${pkg.status}` : pkg.status;
  if (pkg.status === 'blocked') {
    return pkg.blockedBy ? `⛔ blocked by \`${pkg.blockedBy}\`` : '⛔ blocked';
  }
  if (pkg.status !== 'needs_human' || !pkg.needsHuman?.deadline) return status;

  const leftMs = new Date(pkg.needsHuman.deadline).getTime() - now;
  if (!Number.isFinite(leftMs)) return status;
  const leftMin = Math.max(0, Math.ceil(leftMs / 60000));
  return `⚠️ needs human — ${leftMin}m left`;
}

function fmtDuration(pkg) {
  if (!pkg.startedAt) return '—';
  const end = pkg.finishedAt ? new Date(pkg.finishedAt) : new Date();
  const sec = Math.max(0, Math.floor((end - new Date(pkg.startedAt)) / 1000));
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m ${sec % 60}s` : `${sec}s`;
}

export function renderSummaryTable(state, title = 'Release train') {
  const rows = state.packages || [];
  const counts = {};
  for (const p of rows) {
    counts[p.status] = (counts[p.status] || 0) + 1;
  }

  const inProgress =
    (counts.merging || 0) +
    (counts.release_pending || 0) +
    (counts.waiting_ci || 0) +
    (counts.waiting_review || 0) +
    (counts.needs_human || 0) +
    (counts.bumping || 0);

  const branchLine = state.branchName ? `**Branch:** \`${state.branchName}\`` : '';
  const dryRunLine = state.dryRun ? '**dry run**' : '';

  const header = [
    `## ${title}`,
    '',
    [branchLine, dryRunLine].filter(Boolean).join(' · '),
    '',
    `Packages: **${rows.length}** · queued: **${counts.queued || 0}** · in progress: **${inProgress}** · done: **${(counts.done || 0) + (counts.released || 0)}** · failed: **${counts.failed || 0}**${counts.blocked ? ` · blocked: **${counts.blocked}**` : ''}`,
    '',
    '| Repo | Feature PR | Status | Release PR | npm | CI | Snapshots | Duration |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ].filter(Boolean);

  const body = rows.map((p) => {
    return [
      `\`${p.repo}\``,
      fmtFeaturePr(p.featurePr, p.mergeReadiness),
      fmtStatus(p),
      fmtPr(p.releasePr),
      fmtNpmVersion(p),
      fmtCi(p.ci),
      fmtSnapshots(p.snapshots),
      fmtDuration(p),
    ].join(' | ');
  });

  return [...header, ...body.map((r) => `| ${r} |`)].join('\n');
}

export function publishSummary(state, title) {
  const markdown = renderSummaryTable(state, title);
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {
    console.log(markdown);
    return;
  }
  writeFileSync(path, markdown + '\n');
}

/** Append extra markdown after the summary table (links, hints). */
export function appendSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) {
    console.log(markdown);
    return;
  }
  appendFileSync(path, markdown + '\n');
}
