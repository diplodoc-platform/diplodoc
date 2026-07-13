import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Build a transient git auth config (env-only, never written to .git/config
 * or passed as a CLI argument) using GIT_CONFIG_KEY/VALUE_N — this keeps the
 * token out of `ps` process listings and out of the repo's on-disk config,
 * unlike embedding it in the remote URL.
 */
function gitAuthEnv(owner, repo, token) {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.https://github.com/${owner}/${repo}.git.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

function git(dir, args, env) {
  execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
}

/**
 * Bump @diplodoc/* dependency versions on open feature branches (remaining packages).
 */
export function bumpDownstreamDeps({
  owner,
  token,
  branchName,
  publishedVersions,
  targets,
  updateLockfile = true,
}) {
  const results = [];

  for (const target of targets) {
    const { repo, featurePr } = target;
    if (!featurePr?.number) continue;

    const dir = mkdtempSync(join(tmpdir(), `rt-bump-${repo}-`));
    const authEnv = gitAuthEnv(owner, repo, token);
    try {
      execFileSync('gh', ['repo', 'clone', `${owner}/${repo}`, dir, '--', '--depth', '1'], {
        env: { ...process.env, GH_TOKEN: token },
        stdio: 'pipe',
      });
      git(dir, ['fetch', 'origin', branchName], authEnv);
      git(dir, ['checkout', branchName], authEnv);

      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      let changed = false;

      for (const depType of ['dependencies', 'devDependencies', 'peerDependencies']) {
        if (!pkg[depType]) continue;
        for (const [name, version] of Object.entries(publishedVersions)) {
          if (pkg[depType][name] && pkg[depType][name] !== version) {
            pkg[depType][name] = `^${version.replace(/^v/, '')}`;
            changed = true;
          }
        }
      }

      if (!changed) {
        results.push({ repo, bumped: false });
        continue;
      }

      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

      if (updateLockfile) {
        try {
          execFileSync(
            'npm',
            ['install', '--no-workspaces', '--package-lock-only', '--ignore-scripts'],
            { cwd: dir, stdio: 'pipe' },
          );
        } catch (err) {
          console.warn(`::warning::Lockfile refresh failed for ${repo}: ${err.message}`);
        }
      }

      git(dir, ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com']);
      git(dir, ['config', 'user.name', 'github-actions[bot]']);
      git(dir, ['add', 'package.json', 'package-lock.json']);
      git(dir, [
        'commit',
        '-m',
        `chore: bump @diplodoc deps for release train (${Object.keys(publishedVersions).join(', ')})`,
      ]);
      git(dir, ['push', 'origin', branchName], authEnv);

      results.push({ repo, bumped: true, deps: publishedVersions });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return results;
}
