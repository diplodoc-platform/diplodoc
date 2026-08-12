#!/usr/bin/env node
/**
 * Build a topo-sorted release plan for one train.
 *
 * Participants come from three merged sources:
 *   1. state restored from the tracking issue (resume)
 *   2. the explicit `--prs` list (preferred)
 *   3. branch-name discovery (backward-compatible fallback)
 *
 * Usage:
 *   node scripts/release-train/prepare.js --prs cli#12,transform#34
 *   node scripts/release-train/prepare.js --branch feat/foo [--packages cli,utils]
 *   node scripts/release-train/prepare.js --train-id rt-42 --prs cli#12
 *
 * Writes plan.json to cwd and the first report to the tracking issue.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { topoSortSubset } from '../deps-graph.js';
import { loadConfig, trainContext } from './config.js';
import { findOpenPrByBranch, getPr } from './gh.js';
import { parsePrRefs } from './pr-refs.js';
import { mermaidBlock, renderConflictGraph, renderProgressGraph } from './render-graph.js';
import { appendSummary, publishSummary } from './render-summary.js';
import {
  ensureBacklinkComment,
  ensureTrainIssue,
  parseTrainState,
  renderIssueBody,
  resolveTrainId,
  updateTrainIssue,
} from './tracking-issue.js';
import {
  isPackageCompleted,
  mergePlanWithRestoredState,
  restoreTrainState,
  serializeTrainState,
} from './state.js';
import { findMissingUpstream, findUpstreamConflicts } from './topology.js';
import { buildTrainDag, readyRepos, resolveConcurrency, trainEdges } from './scheduler.js';

const { values, positionals } = parseArgs({
  options: {
    'train-id': { type: 'string' },
    prs: { type: 'string' },
    branch: { type: 'string', short: 'b' },
    packages: { type: 'string', short: 'p' },
    'dry-run': { type: 'boolean', default: false },
    'no-issue': { type: 'boolean', default: false },
    concurrency: { type: 'string' },
    output: { type: 'string', default: 'plan.json' },
  },
  allowPositionals: true,
});

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}

const config = loadConfig();
const graph = config.graph;
const dryRun = values['dry-run'];
const useIssue = !values['no-issue'];

const { org, issueOwner, issueRepo, targetBranch } = trainContext(config);

const branchName = values.branch || positionals[0] || null;
const BRANCH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const REPO_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

// Branch names come from workflow_dispatch (fully user-controlled input) and
// are later interpolated into git/gh CLI arguments — allowlist the charset
// to reject anything that isn't a plausible git ref before it reaches any
// shell-out.
if (branchName) {
  if (!BRANCH_NAME_RE.test(branchName) || branchName.includes('..') || branchName.startsWith('-')) {
    fail(`Invalid branch name: ${JSON.stringify(branchName)}`);
  }
}

const requested = values.packages
  ? values.packages.split(',').map((s) => s.trim()).filter(Boolean)
  : null;

if (requested?.length) {
  const invalid = requested.filter((r) => !REPO_SLUG_RE.test(r));
  if (invalid.length) fail(`Invalid package slug(s): ${invalid.join(', ')}`);
  if (!branchName) fail('--packages is only supported together with --branch');
}

const runId = process.env.GITHUB_RUN_ID || null;
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
const runRepo = process.env.GITHUB_REPOSITORY || `${issueOwner}/${issueRepo}`;
const workflow = {
  runId,
  runUrl: runId ? `${serverUrl}/${runRepo}/actions/runs/${runId}` : null,
};

let trainId;
try {
  trainId = resolveTrainId(values['train-id'], process.env.GITHUB_RUN_NUMBER || runId);
} catch (err) {
  fail(err.message);
}

/* ---------------------------------------------------------------- *
 * 1. Tracking issue + restored state                               *
 * ---------------------------------------------------------------- */

let issue = null;
let restored = null;

if (useIssue) {
  try {
    issue = ensureTrainIssue({ owner: issueOwner, repo: issueRepo, trainId, token });
  } catch (err) {
    fail(`Could not create or find tracking issue in ${issueOwner}/${issueRepo}: ${err.message}`);
  }
  restored = restoreTrainState(parseTrainState(issue.body));
  console.log(
    `Tracking issue: ${issue.url} (${issue.created ? 'created' : 'existing'})${restored ? ' — restored RT-STATE' : ''}`,
  );
}

const restoredPackages = restored?.packages || [];
const restoredByRepo = new Map(restoredPackages.map((p) => [p.repo, p]));
const mode = restored?.mode || 'feature-prs';
const issueRef = issue
  ? { owner: issueOwner, repo: issueRepo, number: issue.number, url: issue.url }
  : null;

/**
 * Render and write the tracking issue in one step, so the visible report and
 * the hidden RT-STATE can never describe different states.
 *
 * `required` marks the write that stores the resume state: without it the
 * train would run to completion with no way to resume, so a failure there is
 * fatal rather than a warning.
 */
function writeIssue({ status, state, diagnostics = null, error = null, required = false }) {
  if (!issueRef) return;

  const body = renderIssueBody({
    trainId,
    mode,
    status,
    state,
    workflow,
    graph: renderProgressGraph(state.packages, { edges: planEdges }),
    diagnostics,
    rtState: serializeTrainState({
      trainId,
      mode,
      status,
      issue: issueRef,
      workflow,
      state,
      publishedByNpm: restored?.publishedByNpm || {},
      drift: restored?.drift || null,
      error,
    }),
  });

  try {
    updateTrainIssue({
      owner: issueRef.owner,
      repo: issueRef.repo,
      issueNumber: issueRef.number,
      body,
      token,
    });
  } catch (err) {
    if (!required) {
      console.warn(`::warning::Could not update tracking issue: ${err.message}`);
      return;
    }
    fail(
      `Could not write the tracking issue ${issueRef.url}: ${err.message}\n` +
        'The hidden RT-STATE block in that issue is what a "/rt resume" reads back, so the train is ' +
        'stopped instead of running without resumable state. A 403 here means the GitHub App is ' +
        'missing "Issues: Read and write" on the issue repository. Pass --no-issue to run without a ' +
        'tracking issue (resume will not be available).',
    );
  }
}

/* ---------------------------------------------------------------- *
 * 2. Participants                                                   *
 * ---------------------------------------------------------------- */

/** repo → {repo, npm, featurePr, source} */
const participants = new Map();

function repoConfigOrFail(repo, source) {
  const repoCfg = config.repos[repo];
  if (!repoCfg) {
    fail(`Repo ${JSON.stringify(repo)} (${source}) is not described in release-train.yml`);
  }
  if (!repoCfg.npm) {
    fail(`Repo ${JSON.stringify(repo)} (${source}) has no npm package in release-train.yml`);
  }
  return repoCfg;
}

function addParticipant({ repo, featurePr, source }) {
  const repoCfg = repoConfigOrFail(repo, source);
  const existing = participants.get(repo);
  if (existing) {
    if (featurePr && existing.featurePr && existing.featurePr.number !== featurePr.number) {
      fail(
        `Conflicting PRs for ${repo} in train ${trainId}: #${existing.featurePr.number} (${existing.source}) ` +
          `and #${featurePr.number} (${source}). One PR per repo per train — start a new train instead.`,
      );
    }
    if (!existing.featurePr && featurePr) {
      existing.featurePr = featurePr;
      existing.source = source;
    }
    return existing;
  }

  const entry = {
    repo,
    npm: repoCfg.npm,
    featurePr: featurePr || null,
    merge_method: repoCfg.merge_method,
    auto_approve_release: repoCfg.auto_approve_release,
    auto_merge_feature: repoCfg.auto_merge_feature,
    source,
  };
  participants.set(repo, entry);
  return entry;
}

// 2a. Restored participants.
for (const pkg of restoredPackages) {
  addParticipant({
    repo: pkg.repo,
    featurePr: pkg.featurePr || null,
    source: 'restored',
  });
}

// 2b. Explicit PR list.
if (values.prs) {
  let refs;
  try {
    refs = parsePrRefs(values.prs, org);
  } catch (err) {
    fail(err.message);
  }

  for (const ref of refs) {
    if (ref.owner.toLowerCase() !== org.toLowerCase()) {
      fail(`PR ${ref.raw} belongs to ${ref.owner}, but this train only manages ${org} repos`);
    }
    repoConfigOrFail(ref.repo, 'prs');

    let pr;
    try {
      pr = getPr(ref.owner, ref.repo, ref.number, token);
    } catch (err) {
      fail(`Could not read PR ${ref.owner}/${ref.repo}#${ref.number}: ${err.message}`);
    }

    // A restored participant's PR may have been merged by a previous run that
    // crashed before recording the result — orchestrate reconciles the live
    // PR state per package, so only brand-new participants must arrive open.
    const restored = restoredByRepo.get(ref.repo);
    const mergedRestored = Boolean(restored) && pr.state === 'MERGED';
    if (!isPackageCompleted(restored) && !mergedRestored) {
      if (pr.state !== 'OPEN') {
        fail(`PR ${ref.owner}/${ref.repo}#${ref.number} is ${pr.state}, expected an open PR`);
      }
      if (pr.isDraft) {
        fail(`PR ${ref.owner}/${ref.repo}#${ref.number} is a draft — mark it ready before running the train`);
      }
      if (pr.baseRefName !== targetBranch) {
        fail(
          `PR ${ref.owner}/${ref.repo}#${ref.number} targets ${pr.baseRefName}, expected ${targetBranch}`,
        );
      }
    }

    addParticipant({
      repo: ref.repo,
      featurePr: { number: pr.number, url: pr.url, headRefName: pr.headRefName },
      source: 'prs',
    });
  }
}

// 2c. Branch fallback discovery.
const branchDiscovered = new Set();
if (branchName) {
  for (const [slug, repoCfg] of Object.entries(config.repos)) {
    if (!repoCfg.npm) continue;
    const pr = findOpenPrByBranch(org, slug, branchName, token);
    if (!pr) continue;
    if (pr.isDraft) {
      console.log(`Skipping draft PR ${org}/${slug}#${pr.number} on branch ${branchName}`);
      continue;
    }
    if (pr.baseRefName && pr.baseRefName !== targetBranch) {
      console.log(
        `Skipping ${org}/${slug}#${pr.number}: targets ${pr.baseRefName}, expected ${targetBranch}`,
      );
      continue;
    }
    branchDiscovered.add(slug);
    if (requested?.length && !requested.includes(slug)) continue;
    addParticipant({
      repo: slug,
      featurePr: { number: pr.number, url: pr.url, headRefName: pr.headRefName },
      source: 'branch',
    });
  }

  for (const repo of requested || []) {
    if (!participants.has(repo)) {
      fail(`No open PR for ${org}/${repo} on branch ${branchName}`);
    }
  }
}

if (participants.size === 0) {
  fail(
    'No release train participants found. Pass --prs with PR references, or --branch with open PRs, ' +
      'or resume a train whose tracking issue already has participants.',
  );
}

const withoutPr = [...participants.values()].filter(
  (p) => !p.featurePr && !isPackageCompleted(restoredByRepo.get(p.repo)),
);
if (withoutPr.length) {
  fail(
    `No feature PR known for: ${withoutPr.map((p) => p.repo).join(', ')} — pass them via --prs or remove them from the train`,
  );
}

/* ---------------------------------------------------------------- *
 * 3. Topology                                                       *
 * ---------------------------------------------------------------- */

const selected = [...participants.values()];
const topoSlugs = topoSortSubset(selected.map((s) => s.repo), graph);
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
  fail(
    `Topo-sort dropped ${dropped.length} of ${selected.length} package(s): ${dropped.join(', ')}. ` +
      'The dependency graph is stale or incomplete — run "npm run deps-graph" and commit deps-graph.json.',
  );
}

// The train's own dependency DAG: drives the progress graph here and the
// concurrent schedule in the orchestrator.
const dag = buildTrainDag(ordered, graph, config.nodesByRepo);
const planEdges = trainEdges(dag);
const concurrency = resolveConcurrency(values.concurrency, config.defaults.concurrency, 3);

const completedRepos = restoredPackages.filter(isPackageCompleted).map((p) => p.repo);
const newRepos = ordered.map((o) => o.repo).filter((repo) => !restoredByRepo.has(repo));

const conflicts = findUpstreamConflicts({
  newRepos,
  completedRepos,
  graph,
  nodesByRepo: config.nodesByRepo,
  nodesByNpm: config.nodesByNpm,
});

if (conflicts.length) {
  const lines = conflicts.map(
    (c) =>
      `Cannot add upstream package ${c.upstream} after downstream package ${c.downstream} has already been released in train ${trainId}.`,
  );
  const message = [
    ...lines,
    '',
    'Start a new release train or release a follow-up fix.',
  ].join('\n');

  const diagnosticsState = mergePlanWithRestoredState(
    { trainId, dryRun, branchName, packages: ordered },
    restored,
  );
  writeIssue({
    status: 'failed',
    state: diagnosticsState,
    diagnostics: {
      message,
      graph: renderConflictGraph({
        packages: diagnosticsState.packages,
        conflicts: conflicts.map((c) => ({ upstream: c.upstream, downstream: c.downstream })),
      }),
    },
    error: lines.join(' '),
  });

  fail(message.replace(/\n+/g, ' '));
}

const selectedSet = new Set(ordered.map((o) => o.repo));
const discoveredSet = new Set([...selectedSet, ...branchDiscovered]);
const missingUpstream = findMissingUpstream({
  ordered,
  selectedSet,
  discoveredSet,
  graph,
  nodesByRepo: config.nodesByRepo,
  nodesByNpm: config.nodesByNpm,
});

if (missingUpstream.length) {
  console.error('::error::Excluded upstream PRs that are part of this change set (add them to the train):');
  for (const m of missingUpstream) {
    console.error(`  ${m.consumer} requires ${m.upstream} (${m.npm})`);
  }
  process.exit(1);
}

/* ---------------------------------------------------------------- *
 * 4. Plan + first report                                            *
 * ---------------------------------------------------------------- */

const plan = {
  trainId,
  mode,
  branchName,
  dryRun,
  concurrency,
  org,
  issue: issueRef,
  workflow,
  packages: ordered.map(({ source, ...entry }) => entry),
  restoredState: restored,
  generatedAt: new Date().toISOString(),
};

writeFileSync(values.output, JSON.stringify(plan, null, 2) + '\n');

const state = mergePlanWithRestoredState(plan, restored);
for (const pkg of state.packages) {
  if (pkg.status === 'failed' || isPackageCompleted(pkg)) continue;
  pkg.status = dryRun ? 'queued (dry-run)' : 'queued';
}

writeIssue({ status: dryRun ? 'dry-run' : 'queued', state, required: true });

if (issue) {
  if (dryRun) {
    console.log('Dry run — skipping PR backlink comments.');
  } else {
    for (const pkg of ordered) {
      if (!pkg.featurePr?.number) continue;
      try {
        const result = ensureBacklinkComment({
          owner: org,
          repo: pkg.repo,
          prNumber: pkg.featurePr.number,
          trainId,
          issueUrl: issue.url,
          token,
        });
        console.log(`Backlink ${result.action} on ${org}/${pkg.repo}#${pkg.featurePr.number}`);
      } catch (err) {
        console.warn(
          `::warning::Could not add backlink to ${org}/${pkg.repo}#${pkg.featurePr.number}: ${err.message}`,
        );
      }
    }
  }
}

publishSummary(state, `Release train ${trainId} (queued)`);
if (issue) {
  appendSummary(`\n**Tracking issue:** [${issue.url}](${issue.url})\n`);
}
appendSummary(
  `\n**Train id:** \`${trainId}\`\n\n${mermaidBlock(renderProgressGraph(state.packages, { edges: planEdges }))}`,
);

// What the orchestrator will actually do: each wave is the set of packages
// that may run together once the previous wave has released.
const waves = scheduleWaves(ordered, dag, concurrency);
const wavesText = waves.map((wave, i) => `  ${i + 1}. ${wave.join(', ')}`).join('\n');
console.log(`Schedule (concurrency ${concurrency}):\n${wavesText}`);
appendSummary(
  `\n**Schedule** (concurrency \`${concurrency}\`):\n\n${waves
    .map((wave, i) => `${i + 1}. ${wave.map((r) => `\`${r}\``).join(', ')}`)
    .join('\n')}\n`,
);

/** Dry-run view of the schedule: successive batches of ready packages. */
function scheduleWaves(packages, trainDag, limit) {
  const released = new Set();
  const result = [];

  while (released.size < packages.length) {
    const ready = readyRepos({
      packages,
      dag: trainDag,
      statusOf: (repo) => (released.has(repo) ? 'released' : 'queued'),
    }).slice(0, limit);
    if (!ready.length) break;
    ready.forEach((repo) => released.add(repo));
    result.push(ready);
  }

  return result;
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `train_id=${trainId}`,
      `issue_number=${issue?.number ?? ''}`,
      `issue_url=${issue?.url ?? ''}`,
      '',
    ].join('\n'),
  );
}

console.log(`Train: ${trainId}`);
console.log(`Plan: ${ordered.length} packages — ${ordered.map((p) => p.repo).join(' → ')}`);
console.log(`Wrote ${values.output}`);
