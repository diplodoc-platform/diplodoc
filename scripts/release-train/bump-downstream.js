import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Commit message for a dependency bump. Listing `name@version` pairs keeps the
 * cumulative subject truthful (one commit now carries every accumulated
 * version), and the `owner/repo#N` reference in the body makes GitHub link the
 * commit on the tracking issue's timeline.
 */
export function formatBumpCommitMessage({ trainId, issueRef, publishedVersions }) {
  const deps = Object.entries(publishedVersions)
    .map(([name, version]) => `${name}@${String(version).replace(/^v/, '')}`)
    .join(', ');
  const train = trainId ? ` ${trainId}` : '';
  const subject = `chore: bump @diplodoc deps for release train${train} (${deps})`;
  if (!issueRef?.number) return subject;
  return `${subject}\n\nRelease train: ${issueRef.owner}/${issueRef.repo}#${issueRef.number}`;
}

/**
 * Bump @diplodoc/* dependency versions on open feature branches (remaining packages).
 *
 * Each target carries its own `branch` because feature PRs in a train no
 * longer have to share a branch name; `branchName` is only the fallback for
 * legacy branch-discovered trains.
 */
export function bumpDownstreamDeps({
  owner,
  token,
  branchName,
  publishedVersions,
  targets,
  updateLockfile = true,
  trainId = null,
  issueRef = null,
}) {
  const results = [];

  for (const target of targets) {
    const { repo, featurePr } = target;
    if (!featurePr?.number) continue;
    const branch = target.branch || featurePr.headRefName || branchName;
    if (!branch) {
      console.warn(`::warning::No branch known for ${owner}/${repo} — skipping dependency bump`);
      results.push({ repo, bumped: false });
      continue;
    }

    const dir = mkdtempSync(join(tmpdir(), `rt-bump-${repo}-`));
    const authEnv = gitAuthEnv(owner, repo, token);
    try {
      execFileSync('gh', ['repo', 'clone', `${owner}/${repo}`, dir, '--', '--depth', '1'], {
        env: { ...process.env, GH_TOKEN: token },
        stdio: 'pipe',
      });
      // `gh repo clone --depth 1` is single-branch, so a plain
      // `fetch origin <branch>` only updates FETCH_HEAD and `checkout <branch>`
      // then fails with "pathspec did not match". Fetch into an explicit
      // remote-tracking ref and branch off that instead.
      git(dir, ['fetch', '--depth', '1', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`], authEnv);
      git(dir, ['checkout', '-B', branch, `refs/remotes/origin/${branch}`], authEnv);

      const pkgPath = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      let changed = false;

      for (const depType of ['dependencies', 'devDependencies', 'peerDependencies']) {
        if (!pkg[depType]) continue;
        for (const [name, version] of Object.entries(publishedVersions)) {
          // Compare against the range we would write, not the bare version —
          // otherwise an already-bumped `^1.2.3` looks changed on every resume
          // and produces an empty commit that git rejects.
          const next = `^${String(version).replace(/^v/, '')}`;
          if (pkg[depType][name] && pkg[depType][name] !== next) {
            pkg[depType][name] = next;
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
      // `git add` fails the whole bump on a pathspec that matches nothing, and
      // not every consumer repo commits a lockfile.
      const staged = ['package.json', 'package-lock.json'].filter((file) =>
        existsSync(join(dir, file)),
      );
      git(dir, ['add', ...staged]);

      // The lockfile refresh may normalize the file back to its committed
      // state; committing then fails with "nothing to commit".
      try {
        git(dir, ['diff', '--cached', '--quiet']);
        results.push({ repo, bumped: false });
        continue;
      } catch {
        // non-zero exit means there is something staged — proceed
      }

      git(dir, [
        'commit',
        '-m',
        formatBumpCommitMessage({ trainId, issueRef, publishedVersions }),
      ]);
      git(dir, ['push', 'origin', branch], authEnv);

      results.push({ repo, bumped: true, deps: publishedVersions });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  return results;
}
