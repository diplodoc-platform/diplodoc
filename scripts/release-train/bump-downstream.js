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
 *
 * The commit that lands the bump is pushed with `pushToken`, which MUST be the
 * fine-grained PAT of the `diplodoc-bot` machine user (`INFRA_APPROVER_PAT`),
 * NOT the GitHub App installation token. The identity that authenticates the
 * `git push` is what GitHub reports as `event.sender.login` on the resulting
 * `pull_request` (`synchronize`) webhook. If we push with the App token, the
 * docs-api webhook sees `diplodoc-app[bot]` (a Bot account that is not a team
 * member) and rejects the event; pushing as `diplodoc-bot` (a real user in
 * `@diplodoc-platform/team`) makes the membership check pass. The commit
 * author is set to `diplodoc-bot` for the same reason — so the commit is
 * attributed to the machine user rather than the generic `github-actions[bot]`.
 */
export function bumpDownstreamDeps({
  owner,
  token,
  pushToken = token,
  committerName = 'diplodoc-bot',
  committerEmail = 'diplodoc-bot@users.noreply.github.com',
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
    // Git auth (fetch + push) uses pushToken so the push — and therefore the
    // webhook's event.sender — is attributed to the diplodoc-bot machine user.
    const authEnv = gitAuthEnv(owner, repo, pushToken);
    try {
      execFileSync('gh', ['repo', 'clone', `${owner}/${repo}`, dir, '--', '--depth', '1'], {
        env: { ...process.env, GH_TOKEN: token },
        stdio: 'pipe',
      });
      // `gh repo clone -- --depth 1` produces a shallow, single-branch clone:
      // remote.origin.fetch only tracks the default branch, so a plain
      // `git fetch origin <branch>` lands the commit in FETCH_HEAD without
      // creating a local branch or an origin/<branch> remote-tracking ref.
      // `git checkout <branch>` then fails with "pathspec did not match".
      // Materialize a local branch from FETCH_HEAD explicitly so the later
      // commit + `git push origin <branch>` operate on the feature branch.
      git(dir, ['fetch', 'origin', branchName], authEnv);
      git(dir, ['checkout', '-B', branchName, 'FETCH_HEAD'], authEnv);

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

      git(dir, ['config', 'user.email', committerEmail]);
      git(dir, ['config', 'user.name', committerName]);
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
