/**
 * Pure helpers for the `@diplodoc/*` dependency drift audit.
 *
 * No semver dependency on purpose: release train scripts run with nothing but
 * `js-yaml` installed, so the small subset of range syntax we actually publish
 * (`^x.y.z`, `~x.y.z`, exact pins) is handled here.
 */

/** Sections scanned in a consumer package.json. */
export const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies'];

/** `npm install --save-*` cannot write peerDependencies — those are reported
 * but never auto-updated. */
export function isUpdatableSection(section) {
  return section === 'dependencies' || section === 'devDependencies';
}

export function parseVersionParts(version) {
  const match = String(version ?? '').match(/(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

/** -1 / 0 / 1, with any prerelease sorting before its release. */
export function compareVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return 0;
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

/** Whether the declared range already resolves to `latest` on a fresh install. */
export function rangeAllowsLatest(range, latest) {
  const declared = String(range ?? '').trim();
  const base = parseVersionParts(declared);
  const target = parseVersionParts(latest);
  if (!base || !target) return false;
  if (compareVersions(latest, declared) < 0) return false;

  if (declared.startsWith('^')) {
    if (base.major > 0) return target.major === base.major;
    if (base.minor > 0) return target.major === 0 && target.minor === base.minor;
    return target.major === 0 && target.minor === 0 && target.patch === base.patch;
  }
  if (declared.startsWith('~')) {
    return target.major === base.major && target.minor === base.minor;
  }
  return compareVersions(declared, latest) === 0;
}

/**
 * Classify one declared dependency against the latest published version.
 * @returns {{comparable: boolean, stale: boolean, allowsLatest: boolean}}
 */
export function classifyDependency(range, latest) {
  const declared = String(range ?? '').trim();
  const comparable = Boolean(parseVersionParts(declared) && parseVersionParts(latest));
  if (!comparable) return { comparable: false, stale: false, allowsLatest: false };
  const stale = compareVersions(declared, latest) < 0;
  return { comparable: true, stale, allowsLatest: rangeAllowsLatest(declared, latest) };
}

/**
 * Group stale rows into the per-repo update plan stored in `RT-STATE.drift`.
 * @param {Array<{repo: string, name: string, section: string, declared: string, latest: string}>} rows
 */
export function buildUpdatePlan(rows) {
  const byRepo = new Map();

  for (const row of rows) {
    if (!isUpdatableSection(row.section)) continue;
    if (!byRepo.has(row.repo)) byRepo.set(row.repo, { repo: row.repo, packages: [] });
    const entry = byRepo.get(row.repo);
    if (entry.packages.some((p) => p.name === row.name && p.section === row.section)) continue;
    entry.packages.push({ name: row.name, version: 'latest', section: row.section });
  }

  return [...byRepo.values()].sort((a, b) => a.repo.localeCompare(b.repo));
}

/**
 * Explain an `update-deps.yml` dispatch failure in terms of its actual cause.
 *
 * `workflow_dispatch` runs the workflow definition taken from the ref it is
 * dispatched on, so `Unexpected inputs` means *that ref's* copy of
 * update-deps.yml predates the `create_pr` input (scaffolding v2.2.2). Drift
 * branches are cut from the target branch and then reused by later runs of the
 * same train, so the usual culprit is a leftover branch rather than stale
 * scaffolding — and updating the scaffolding would not fix that one.
 */
export function dispatchFailureHint({ message, branch, branchReused, targetBranch = 'master' }) {
  if (!/nexpected inputs/i.test(String(message || ''))) return '';
  return branchReused
    ? ` — the reused \`${branch}\` branch predates the \`create_pr\` input in update-deps.yml; delete that branch or start a train with a new id`
    : ` — \`${targetBranch}\` in this repo still has an update-deps.yml without the \`create_pr\` input, update its scaffolding`;
}

/** `packages` input for update-deps.yml: `dev:` marks devDependencies. */
export function updateDepsPackagesInput(update) {
  return update.packages
    .map((p) => (p.section === 'devDependencies' ? `dev:${p.name}` : p.name))
    .join(',');
}

export function renderDriftTable(rows) {
  if (!rows.length) return '_No stale `@diplodoc/*` dependencies found._';

  const header = [
    '| Repo | Package | Section | Declared | Latest | Install picks latest |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  const body = rows.map((row) =>
    [
      '',
      `\`${row.repo}\``,
      `\`${row.name}\``,
      row.section === 'devDependencies' ? 'dev' : row.section === 'peerDependencies' ? 'peer' : 'prod',
      `\`${row.declared}\``,
      `\`${row.latest}\``,
      row.allowsLatest ? 'yes' : 'no',
      '',
    ].join(' | ').trim(),
  );

  return [...header, ...body].join('\n');
}
