import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_PATH = join(process.cwd(), '.release-train-state.json');

export function createPackageState(entry) {
  return {
    repo: entry.repo,
    npm: entry.npm,
    status: 'queued',
    featurePr: entry.featurePr || null,
    releasePr: null,
    npmVersion: null,
    ci: { state: 'pending', url: null, failingCheck: null },
    snapshots: { state: 'none', url: null, message: null },
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
    branchName: plan.branchName,
    dryRun: plan.dryRun,
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
