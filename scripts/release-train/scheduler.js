/**
 * Dependency-aware scheduling for the release train.
 *
 * The train used to walk `topoOrder` strictly one package at a time, even
 * though most packages are independent (the graph has ~10 roots). This module
 * turns the committed dependency graph into the train's own DAG so packages
 * whose in-train upstreams are all released can run concurrently.
 *
 * Pure and IO-free — the orchestrator owns all effects.
 */

/** Statuses that let a downstream package start. */
const RELEASED_STATUSES = new Set(['released', 'done']);

/** Statuses a scheduler must never restart. */
const TERMINAL_STATUSES = new Set(['released', 'done', 'failed', 'blocked']);

/**
 * In-train upstreams per package: repo → Set(upstream repos in this train).
 *
 * Graph edges point from the dependent package to its dependency
 * (`cli → ajv` means cli depends on ajv), which is the reverse of the release
 * order, so the edge is recorded on the dependent side.
 */
export function buildTrainDag(packages, graph, nodesByRepo) {
  const members = new Set(packages.map((p) => p.repo));
  const repoByNpm = new Map();
  for (const repo of members) {
    const npm = nodesByRepo.get(repo)?.npm;
    if (npm) repoByNpm.set(npm, repo);
  }

  const dag = new Map([...members].map((repo) => [repo, new Set()]));

  for (const edge of graph.edges || []) {
    const dependent = repoByNpm.get(edge.from);
    const dependency = repoByNpm.get(edge.to);
    if (!dependent || !dependency || dependent === dependency) continue;
    dag.get(dependent).add(dependency);
  }

  return dag;
}

/** Edges for rendering: {from: upstream, to: downstream} in release order. */
export function trainEdges(dag) {
  const edges = [];
  for (const [repo, upstreams] of dag) {
    for (const upstream of upstreams) {
      edges.push({ from: upstream, to: repo });
    }
  }
  return edges;
}

/**
 * Packages that may start now: not terminal, not already running, and with
 * every in-train upstream released. Order follows `packages` (topological), so
 * a narrow concurrency window still prefers the packages most work depends on.
 */
export function readyRepos({ packages, dag, statusOf, running = new Set() }) {
  const ready = [];

  for (const pkg of packages) {
    const repo = pkg.repo;
    if (running.has(repo)) continue;
    if (TERMINAL_STATUSES.has(statusOf(repo))) continue;

    const upstreams = dag.get(repo) || new Set();
    const blocked = [...upstreams].some((up) => !RELEASED_STATUSES.has(statusOf(up)));
    if (!blocked) ready.push(repo);
  }

  return ready;
}

/** Transitive in-train dependents of `repo`. */
export function downstreamOf(repo, dag) {
  const result = new Set();
  const queue = [repo];

  while (queue.length) {
    const current = queue.shift();
    for (const [candidate, upstreams] of dag) {
      if (!upstreams.has(current) || result.has(candidate)) continue;
      result.add(candidate);
      queue.push(candidate);
    }
  }

  return result;
}

/**
 * Packages that can no longer run because `failedRepo` did not release.
 * Independent packages are deliberately left alone: one failure should cost
 * the train its dependents, not everything still queued.
 */
export function blockedByFailure(failedRepo, dag, statusOf) {
  return [...downstreamOf(failedRepo, dag)].filter((repo) => !TERMINAL_STATUSES.has(statusOf(repo)));
}

/** Concurrency from plan/config, clamped to a sane window. */
export function resolveConcurrency(...candidates) {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 1) return Math.min(Math.floor(value), 10);
  }
  return 1;
}
