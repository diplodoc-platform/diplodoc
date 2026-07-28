import { execFileSync } from 'node:child_process';
import { pollUntil } from './poll.js';

export async function waitForNpmPackage(npmName, version, timeoutMin = 15) {
  const npmVersion = version.replace(/^v/, '');
  const intervalS = 10;

  return pollUntil({
    timeoutMin,
    intervalS,
    check: (attempt) => {
      let found;
      try {
        found = execFileSync('npm', ['view', `${npmName}@${npmVersion}`, 'version'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch {
        found = null; // not published yet
      }
      if (found === npmVersion) {
        console.log(`::notice title=npm verified::${npmName}@${npmVersion} available after ${attempt} attempt(s).`);
        return npmVersion;
      }
      console.log(`npm wait ${attempt}: ${npmName}@${npmVersion} not ready…`);
      return null;
    },
    onTimeout: () => new Error(`${npmName}@${npmVersion} not on npm within ${timeoutMin} minutes`),
  });
}

export function readPackageJsonFromRepo(owner, repo, ref, token) {
  const out = execFileSync(
    'gh',
    ['api', `repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(ref)}`],
    { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token } },
  );
  const data = JSON.parse(out);
  const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
  return JSON.parse(content);
}

export function readPackageVersionFromRepo(owner, repo, ref, token) {
  return readPackageJsonFromRepo(owner, repo, ref, token).version;
}

/** Latest published version of an npm package, or null when unpublished. */
export function npmLatestVersion(npmName) {
  try {
    return execFileSync('npm', ['view', npmName, 'version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}
