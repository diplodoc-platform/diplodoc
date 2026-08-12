import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_PATH = join(process.cwd(), '.release-train-state.json');

/** Schema version of the `RT-STATE` block stored in the tracking issue. */
export const RT_STATE_VERSION = 1;

/** Statuses that mean "this package needs no further work in this train". */
const COMPLETED_STATUSES = new Set(['done', 'released']);

export function createPackageState(entry) {
  return {
    repo: entry.repo,
    npm: entry.npm,
    status: 'queued',
    featurePr: entry.featurePr || null,
    releasePr: null,
    npmVersion: null,
    pendingVersion: null,
    ci: { state: 'pending', url: null, failingCheck: null },
    snapshots: { state: 'none', url: null, message: null },
    mergeReadiness: null,
    bumpedDeps: null,
    needsHuman: null,
    autoMergeEnabled: false,
    startedAt: null,
    finishedAt: null,
    error: null,
  };
}

export function loadState(path = DEFAULT_PATH) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveState(state, path = DEFAULT_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

export function initState(plan) {
  return {
    trainId: plan.trainId || null,
    mode: plan.mode || 'feature-prs',
    branchName: plan.branchName || null,
    dryRun: Boolean(plan.dryRun),
    startedAt: new Date().toISOString(),
    packages: plan.packages.map((p) => createPackageState(p)),
  };
}

export function findPackage(state, repo) {
  return state.packages.find((p) => p.repo === repo);
}

export function updatePackage(state, repo, patch) {
  const pkg = findPackage(state, repo);
  if (!pkg) return state;
  Object.assign(pkg, patch);
  return state;
}

export function isPackageCompleted(pkg) {
  return COMPLETED_STATUSES.has(String(pkg?.status || ''));
}

/**
 * Build the machine-readable `RT-STATE` payload stored in the tracking issue.
 * This is the durable source of truth a resume run reads back.
 */
export function serializeTrainState({
  trainId,
  mode = 'feature-prs',
  status = 'running',
  issue = null,
  workflow = null,
  state = null,
  publishedByNpm = {},
  drift = null,
  error = null,
  finishedAt = null,
}) {
  const packages = state?.packages || [];
  return {
    version: RT_STATE_VERSION,
    trainId,
    mode,
    status,
    issue,
    workflow,
    branchName: state?.branchName ?? null,
    dryRun: Boolean(state?.dryRun),
    startedAt: state?.startedAt || null,
    updatedAt: new Date().toISOString(),
    finishedAt,
    participants: packages.map((p) => ({
      repo: p.repo,
      npm: p.npm,
      prNumber: p.featurePr?.number ?? null,
      prUrl: p.featurePr?.url ?? null,
      headRefName: p.featurePr?.headRefName ?? null,
    })),
    publishedByNpm: { ...publishedByNpm },
    drift,
    error,
    state: { packages },
  };
}

/* ------------------------------------------------------------------ *
 * Restoring RT-STATE.                                                  *
 *                                                                      *
 * The block lives in an issue body, i.e. in storage that humans can    *
 * edit, and its values are fed straight back into git refs, `gh`       *
 * arguments and package.json ranges. Everything read back is therefore *
 * re-validated here rather than trusted.                               *
 * ------------------------------------------------------------------ */

const KNOWN_STATUSES = new Set([
  'queued',
  'queued (dry-run)',
  'waiting_ci',
  'merging',
  'release_pending',
  'waiting_release_review',
  'needs_human',
  'bumping',
  'released',
  'done',
  'failed',
]);

const REPO_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const GIT_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const NPM_NAME_RE = /^@?[a-z0-9][a-z0-9._/-]{0,99}$/;
const VERSION_RE = /^v?\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/;

function safeRef(value) {
  const ref = String(value ?? '').trim();
  if (!ref || ref.includes('..') || !GIT_REF_RE.test(ref)) return null;
  return ref;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function safeUrl(value) {
  const url = String(value ?? '').trim();
  return url.startsWith('https://github.com/') && !/\s/.test(url) ? url : null;
}

function safeVersion(value) {
  const version = String(value ?? '').trim();
  return VERSION_RE.test(version) ? version.replace(/^v/, '') : null;
}

function safePr(pr) {
  const number = safeNumber(pr?.number);
  if (!number) return null;
  return { number, url: safeUrl(pr.url), headRefName: safeRef(pr.headRefName) };
}

/** Unknown statuses fall back to `queued`: redoing work is safe, skipping is not. */
function safeStatus(status) {
  const value = String(status ?? '');
  return KNOWN_STATUSES.has(value) ? value : 'queued';
}

function safePackage(pkg) {
  const repo = String(pkg?.repo ?? '');
  if (!REPO_SLUG_RE.test(repo)) return null;
  return {
    ...pkg,
    repo,
    npm: NPM_NAME_RE.test(String(pkg.npm ?? '')) ? pkg.npm : null,
    status: safeStatus(pkg.status),
    featurePr: safePr(pkg.featurePr),
    releasePr: safePr(pkg.releasePr),
    npmVersion: safeVersion(pkg.npmVersion),
    pendingVersion: safeVersion(pkg.pendingVersion),
  };
}

function safePublishedVersions(published) {
  const entries = Object.entries(published || {})
    .map(([name, version]) => [name, safeVersion(version)])
    .filter(([name, version]) => version && NPM_NAME_RE.test(name));
  return Object.fromEntries(entries);
}

/**
 * Read back a serialized `RT-STATE`. Unknown schema versions are ignored
 * rather than half-applied: a resume must not silently drop fields it cannot
 * interpret.
 */
export function restoreTrainState(rtState) {
  if (!rtState || typeof rtState !== 'object') return null;
  if (rtState.version !== RT_STATE_VERSION) {
    console.warn(
      `::warning::Ignoring RT-STATE with unsupported schema version ${JSON.stringify(rtState.version)} (expected ${RT_STATE_VERSION})`,
    );
    return null;
  }

  const packages = (Array.isArray(rtState.state?.packages) ? rtState.state.packages : [])
    .map(safePackage)
    .filter(Boolean);

  return {
    trainId: rtState.trainId || null,
    mode: rtState.mode || 'feature-prs',
    status: rtState.status || null,
    branchName: safeRef(rtState.branchName),
    dryRun: Boolean(rtState.dryRun),
    startedAt: rtState.startedAt || null,
    participants: Array.isArray(rtState.participants) ? rtState.participants : [],
    packages,
    publishedByNpm: safePublishedVersions(rtState.publishedByNpm),
    drift: rtState.drift || null,
  };
}

/**
 * Overlay per-package progress from a restored state onto a freshly built plan.
 *
 * The plan drives topology (order, participants); the restored state drives
 * progress (status, published versions, PR links). Packages added during a
 * resume simply start `queued`.
 */
export function mergePlanWithRestoredState(plan, restored) {
  const state = initState(plan);
  if (!restored) return state;

  state.startedAt = restored.startedAt || state.startedAt;

  const restoredByRepo = new Map((restored.packages || []).map((p) => [p.repo, p]));

  for (const pkg of state.packages) {
    const prev = restoredByRepo.get(pkg.repo);
    if (!prev) continue;
    Object.assign(pkg, {
      status: prev.status || pkg.status,
      releasePr: prev.releasePr ?? null,
      npmVersion: prev.npmVersion ?? null,
      pendingVersion: prev.pendingVersion ?? null,
      ci: prev.ci || pkg.ci,
      snapshots: prev.snapshots || pkg.snapshots,
      mergeReadiness: prev.mergeReadiness ?? null,
      bumpedDeps: prev.bumpedDeps ?? null,
      // A resume is an explicit human action, so a package that ran out of its
      // grace window starts a fresh one instead of inheriting a past deadline.
      needsHuman: null,
      autoMergeEnabled: Boolean(prev.autoMergeEnabled),
      startedAt: prev.startedAt ?? null,
      finishedAt: prev.finishedAt ?? null,
      error: prev.error ?? null,
      // The plan's PR data is authoritative (it was just re-read from GitHub),
      // but a completed package may no longer have an open PR to re-read.
      featurePr: pkg.featurePr || prev.featurePr || null,
    });
  }

  return state;
}
