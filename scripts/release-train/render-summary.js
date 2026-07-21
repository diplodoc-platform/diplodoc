/**
 * Markdown summary table for release train (GITHUB_STEP_SUMMARY).
 */

import { writeFileSync, writeSync } from 'node:fs';

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
    return ci.url ? `❌ [${ci.failingCheck || 'check'}](${ci.url})` : '❌';
  }
  return ci.state;
}

function fmtPr(pr) {
  if (!pr) return '—';
  return `[#${pr.number}](${pr.url})`;
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
    (counts.bumping || 0);

  const header = [
    `## ${title}`,
    '',
    state.branchName
      ? `**Branch:** \`${state.branchName}\`${state.dryRun ? ' · **dry run**' : ''}`
      : '',
    '',
    `Packages: **${rows.length}** · queued: **${counts.queued || 0}** · in progress: **${inProgress}** · done: **${(counts.done || 0) + (counts.released || 0)}** · failed: **${counts.failed || 0}**`,
    '',
    '| Repo | Feature PR | Status | Release PR | npm | CI | Snapshots | Duration |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ].filter(Boolean);

  const body = rows.map((p) => {
    const status = p.error ? `❌ ${p.status}` : p.status;
    return [
      `\`${p.repo}\``,
      fmtPr(p.featurePr),
      status,
      fmtPr(p.releasePr),
      p.npmVersion || '—',
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

/**
 * Stream the current table to the step log (stdout) for live progress.
 *
 * GitHub renders $GITHUB_STEP_SUMMARY only *after* a step finishes, so a
 * long-running orchestrate step shows nothing until it exits. The step log,
 * by contrast, is streamed in near real time — so we also print the table
 * there on every persist().
 *
 * We use writeSync(1, …) instead of console.log because Node buffers stdout
 * when it is a pipe (as in Actions), which can withhold output for minutes;
 * a synchronous write forces each snapshot out immediately. The output is
 * wrapped in a collapsible ::group:: so the log stays readable despite many
 * repeated snapshots.
 */
export function logProgress(state, title = 'Release train — progress') {
  const markdown = renderSummaryTable(state, title);
  const ts = new Date().toISOString();
  writeSync(1, `::group::${title} @ ${ts}\n${markdown}\n::endgroup::\n`);
}
