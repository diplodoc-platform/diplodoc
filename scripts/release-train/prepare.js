#!/usr/bin/env node
/**
 * Discover open PRs by branch name and build topo-sorted release plan.
 *
 * Usage:
 *   node scripts/release-train/prepare.js --branch feat/foo [--packages cli,utils] [--dry-run]
 *
 * Writes plan.json to cwd.
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { topoSortSubset } from '../deps-graph.js';
import { loadConfig } from './config.js';
import { findOpenPrByBranch } from './gh.js';

const { values, positionals } = parseArgs({
  options: {
    branch: { type: 'string', short: 'b' },
    packages: { type: 'string', short: 'p' },
    'dry-run': { type: 'boolean', default: false },
    output: { type: 'string', default: 'plan.json' },
  },
  allowPositionals: true,
});

const branchName = values.branch || positionals[0];
if (!branchName) {
  console.error('Usage: prepare.js --branch <name> [--packages a,b] [--dry-run]');
  process.exit(1);
}

// Branch names come from workflow_dispatch (fully user-controlled input) and
// are later interpolated into git/gh CLI arguments — allowlist the charset
// to reject anything that isn't a plausible git ref before it reaches any
// shell-out.
const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
if (!BRANCH_NAME_RE.test(branchName) || branchName.includes('..') || branchName.startsWith('-')) {
  console.error(`::error::Invalid branch name: ${JSON.stringify(branchName)}`);
  process.exit(1);
}

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}

const config = loadConfig();
const graph = config.graph;
const org = config.org;
const dryRun = values['dry-run'];

const REPO_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

const requested = values.packages
  ? values.packages.split(',').map((s) => s.trim()).filter(Boolean)
  : null;

if (requested?.length) {
  const invalid = requested.filter((r) => !REPO_SLUG_RE.test(r));
  if (invalid.length) {
    console.error(`::error::Invalid package slug(s): ${invalid.join(', ')}`);
    process.exit(1);
  }
}

const discovered = [];

for (const [slug, repoCfg] of Object.entries(config.repos)) {
  if (!repoCfg.npm) continue;
  const pr = findOpenPrByBranch(org, slug, branchName, token);
  if (pr) {
    discovered.push({
      repo: slug,
      npm: repoCfg.npm,
      featurePr: { number: pr.number, url: pr.url, headRefName: pr.headRefName },
      merge_method: repoCfg.merge_method,
      auto_approve_release: repoCfg.auto_approve_release,
      auto_merge_feature: repoCfg.auto_merge_feature,
    });
  }
}

let selected = discovered;
if (requested?.length) {
  const reqSet = new Set(requested);
  selected = discovered.filter((d) => reqSet.has(d.repo));
  for (const r of requested) {
    if (!selected.find((d) => d.repo === r)) {
      console.error(`::error::No open PR for ${org}/${r} on branch ${branchName}`);
      process.exit(1);
    }
  }
}

if (selected.length === 0) {
  console.error(`::error::No open PRs found for branch ${branchName}`);
  process.exit(1);
}

const topoSlugs = topoSortSubset(
  selected.map((s) => s.repo),
  graph,
);

const selectedByRepo = new Map(selected.map((s) => [s.repo, s]));
const ordered = topoSlugs.map((slug) => selectedByRepo.get(slug)).filter(Boolean);

// A non-empty `selected` must always survive topo-sorting. If `ordered` is
// empty (or shrank), the dependency graph is missing the discovered repos —
// e.g. a stale/empty deps-graph.json, or repos present in release-train.yml
// but absent from the graph. Fail loudly instead of writing a plan with zero
// packages (previously this slipped through and produced `packages: []`).
if (ordered.length !== selected.length) {
  const orderedSet = new Set(ordered.map((o) => o.repo));
  const dropped = selected.map((s) => s.repo).filter((r) => !orderedSet.has(r));
  console.error(
    `::error::Topo-sort dropped ${dropped.length} of ${selected.length} discovered package(s): ${dropped.join(', ')}. ` +
      'The dependency graph is stale or incomplete — run "npm run deps-graph" and commit deps-graph.json.',
  );
  process.exit(1);
}

// Validate that no *changing* upstream dependency was excluded from the train.
//
// A dependency only needs to be in the train if it is ALSO being changed on
// this branch — i.e. it has its own open PR (is in `discovered`). A dependency
// without a PR is not changing, so the consumer keeps using its already
// published version; that is the normal case and must NOT be an error.
//
// Previously this flagged EVERY prod/peer dependency that lacked a PR, so a
// package like `cli` (which legitimately depends on ajv/client/liquid/…)
// produced a wall of false "missing upstream" errors even though nothing but
// the selected packages needed changes. The real failure mode this guards
// against is `--packages` excluding a dependency that *does* have a PR.
const selectedSet = new Set(ordered.map((o) => o.repo));
const discoveredSet = new Set(discovered.map((d) => d.repo));
const missingUpstream = [];
const nodesByRepo = config.nodesByRepo;
const nodesByNpm = config.nodesByNpm;

for (const pkg of ordered) {
  const node = nodesByRepo.get(pkg.repo);
  if (!node) continue;
  for (const edge of graph.edges) {
    if (edge.from !== node.npm) continue;
    const upNode = nodesByNpm.get(edge.to);
    if (!upNode) continue;
    if (selectedSet.has(upNode.repo)) continue; // already in train
    if (!discoveredSet.has(upNode.repo)) continue; // no PR → not changing, uses published version
    // upstream HAS a PR on this branch but was excluded from the train
    // (only reachable via --packages) — releasing the consumer without it
    // would merge against an unreleased dependency change.
    if (edge.type === 'prod' || edge.type === 'peer') {
      missingUpstream.push({ consumer: pkg.repo, upstream: upNode.repo, npm: edge.to });
    }
  }
}

if (missingUpstream.length) {
  console.error(
    '::error::Excluded upstream PRs that are part of this change set (add them to --packages):',
  );
  for (const m of missingUpstream) {
    console.error(`  ${m.consumer} requires ${m.upstream} (${m.npm})`);
  }
  process.exit(1);
}

const plan = {
  branchName,
  dryRun,
  org,
  packages: ordered,
  generatedAt: new Date().toISOString(),
};

writeFileSync(values.output, JSON.stringify(plan, null, 2) + '\n');
console.log(`Plan: ${ordered.length} packages — ${ordered.map((p) => p.repo).join(' → ')}`);
console.log(`Wrote ${values.output}`);
