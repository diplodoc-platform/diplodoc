/**
 * Pure dependency-graph checks used when building a train plan.
 *
 * Kept free of GitHub/IO so the guard rules can be unit-tested.
 */

/**
 * Transitive `@diplodoc/*` dependencies of an npm package.
 * @param {string} npm - starting package name
 * @param {{edges: Array<{from: string, to: string, type: string}>}} graph
 * @param {{types?: string[]}} [options] - edge types to follow (default: all)
 */
export function dependencyClosure(npm, graph, options = {}) {
  const { types } = options;
  const closure = new Set();
  const queue = [npm];

  while (queue.length) {
    const current = queue.shift();
    for (const edge of graph.edges) {
      if (edge.from !== current) continue;
      if (types && !types.includes(edge.type)) continue;
      if (closure.has(edge.to)) continue;
      closure.add(edge.to);
      queue.push(edge.to);
    }
  }

  return closure;
}

/**
 * Reject adding an upstream package in front of a package that this train has
 * already released: the released version cannot pick up the new upstream
 * change without a follow-up release, so the resume would silently produce an
 * inconsistent set.
 *
 * @returns {Array<{upstream: string, downstream: string, npm: string}>}
 */
export function findUpstreamConflicts({ newRepos, completedRepos, graph, nodesByRepo, nodesByNpm }) {
  const conflicts = [];

  for (const completed of completedRepos) {
    const completedNode = nodesByRepo.get(completed);
    if (!completedNode) continue;
    const closure = dependencyClosure(completedNode.npm, graph);

    for (const added of newRepos) {
      const addedNode = nodesByRepo.get(added);
      if (!addedNode) continue;
      if (!closure.has(addedNode.npm)) continue;
      // Only report the dependency edge that actually exists in the graph.
      const npm = nodesByNpm.get(addedNode.npm)?.npm || addedNode.npm;
      conflicts.push({ upstream: added, downstream: completed, npm });
    }
  }

  return conflicts;
}

/**
 * Prod/peer dependencies that are *also changing in this change set* (they
 * have their own PR) but were excluded from the train — merging the consumer
 * without them would release it against an unreleased dependency change.
 *
 * A dependency without a PR is not changing and is therefore fine.
 */
export function findMissingUpstream({ ordered, selectedSet, discoveredSet, graph, nodesByRepo, nodesByNpm }) {
  const missing = [];

  for (const pkg of ordered) {
    const node = nodesByRepo.get(pkg.repo);
    if (!node) continue;
    for (const edge of graph.edges) {
      if (edge.from !== node.npm) continue;
      if (edge.type !== 'prod' && edge.type !== 'peer') continue;
      const upNode = nodesByNpm.get(edge.to);
      if (!upNode) continue;
      if (selectedSet.has(upNode.repo)) continue;
      if (!discoveredSet.has(upNode.repo)) continue;
      missing.push({ consumer: pkg.repo, upstream: upNode.repo, npm: edge.to });
    }
  }

  return missing;
}
