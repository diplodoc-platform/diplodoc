/**
 * Mermaid graphs for the tracking issue.
 *
 * GitHub's Mermaid renderer is strict inside square-bracket labels: double
 * quotes and parentheses break the diagram. `label()` therefore reduces every
 * label to `<repo> <status-word>`.
 */

const CLASS_DEFS = [
  'classDef done fill:#b7eb8f,stroke:#389e0d,color:#000',
  'classDef running fill:#91d5ff,stroke:#096dd9,color:#000',
  'classDef queued fill:#ffe58f,stroke:#d48806,color:#000',
  'classDef failed fill:#ffa39e,stroke:#cf1322,color:#000',
  'classDef skipped fill:#d9d9d9,stroke:#8c8c8c,color:#000',
  'classDef conflict fill:#ffa39e,stroke:#cf1322,color:#000',
];

const COMPLETED = new Set(['done', 'released']);

export function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (COMPLETED.has(value)) return 'done';
  if (value === 'failed') return 'failed';
  if (value.startsWith('queued')) return 'queued';
  if (value === 'skipped' || value === 'blocked') return 'skipped';
  // Waiting on a human is stalled, not progressing — colour it like a queue.
  if (value === 'needs_human') return 'queued';
  return 'running';
}

/** Mermaid-safe label text: no quotes, no parens, single spaces. */
export function label(repo, status) {
  const clean = (s) =>
    String(s || '')
      .replace(/["'()[\]{}<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const statusText = clean(status);
  return statusText ? `${clean(repo)} ${statusText}` : clean(repo);
}

function classLines(byClass) {
  return [...byClass.entries()]
    .filter(([, ids]) => ids.length > 0)
    .map(([cls, ids]) => `class ${ids.join(',')} ${cls}`);
}

/**
 * Train progress, coloured by status.
 *
 * With `edges` (upstream → downstream, from scheduler.trainEdges) the real
 * dependency DAG is drawn, so independent packages appear as parallel roots —
 * which is how the train actually runs them. Without it the packages are
 * chained in the order given.
 */
export function renderProgressGraph(packages = [], { edges = null } = {}) {
  if (!packages.length) return '';

  const lines = ['flowchart LR'];
  const byClass = new Map(
    ['done', 'running', 'queued', 'failed', 'skipped'].map((c) => [c, []]),
  );

  const idByRepo = new Map();
  packages.forEach((pkg, index) => {
    const id = `n${index}`;
    idByRepo.set(pkg.repo, id);
    lines.push(`    ${id}[${label(pkg.repo, pkg.status)}]`);
    byClass.get(statusClass(pkg.status))?.push(id);
  });

  if (edges) {
    const seen = new Set();
    for (const { from, to } of edges) {
      const fromId = idByRepo.get(from);
      const toId = idByRepo.get(to);
      if (!fromId || !toId || fromId === toId) continue;
      const key = `${fromId}>${toId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`    ${fromId} --> ${toId}`);
    }
  } else {
    for (let i = 1; i < packages.length; i++) {
      lines.push(`    n${i - 1} --> n${i}`);
    }
  }

  return [...lines, ...CLASS_DEFS.map((d) => `    ${d}`), ...classLines(byClass).map((l) => `    ${l}`)].join(
    '\n',
  );
}

/**
 * Diagnostics graph for a rejected topology change: the newly added upstream
 * package is drawn in red in front of the already completed package it would
 * have to precede.
 *
 * @param {{packages: Array, conflicts: Array<{upstream: string, downstream: string}>}} input
 */
export function renderConflictGraph({ packages = [], conflicts = [] }) {
  if (!conflicts.length) return '';

  const lines = ['flowchart LR'];
  const ids = new Map();
  const byClass = new Map(
    ['done', 'running', 'queued', 'failed', 'skipped', 'conflict'].map((c) => [c, []]),
  );

  const conflictRepos = new Set(conflicts.map((c) => c.upstream));

  const nodeId = (repo, status) => {
    if (ids.has(repo)) return ids.get(repo);
    const id = `n${ids.size}`;
    ids.set(repo, id);
    lines.push(`    ${id}[${label(repo, status)}]`);
    const cls = conflictRepos.has(repo) ? 'conflict' : statusClass(status);
    byClass.get(cls)?.push(id);
    return id;
  };

  const statusOf = (repo) =>
    packages.find((p) => p.repo === repo)?.status || (conflictRepos.has(repo) ? 'added' : 'queued');

  for (const pkg of packages) nodeId(pkg.repo, pkg.status);

  const conflictEdges = [];
  for (const { upstream, downstream } of conflicts) {
    const from = nodeId(upstream, statusOf(upstream));
    const to = nodeId(downstream, statusOf(downstream));
    conflictEdges.push(lines.filter((l) => l.includes('-->')).length);
    lines.push(`    ${from} --> ${to}`);
  }

  const linkStyles = conflictEdges.map((i) => `    linkStyle ${i} stroke:#cf1322,stroke-width:2px`);

  return [
    ...lines,
    ...CLASS_DEFS.map((d) => `    ${d}`),
    ...classLines(byClass).map((l) => `    ${l}`),
    ...linkStyles,
  ].join('\n');
}

/** Wrap a graph body into a fenced mermaid block; empty input yields ''. */
export function mermaidBlock(graph) {
  if (!graph) return '';
  return ['```mermaid', graph, '```'].join('\n');
}
