import { execFileSync } from 'node:child_process';
import { pollUntil } from './poll.js';

const defaultWaitDeps = { execFileSync, pollUntil };

export async function waitForNpmPackage(npmName, version, timeoutMin = 15, deps = defaultWaitDeps) {
  const npmVersion = version.replace(/^v/, '');
  const packageSpec = `${npmName}@${npmVersion}`;

  return deps.pollUntil({
    timeoutMin,
    intervalS: 10,
    check: (attempt) => {
      try {
        // The version can appear in registry metadata before its archive can
        // be downloaded. A dry pack fetches the archive without running scripts.
        const output = deps.execFileSync(
          'npm',
          ['pack', packageSpec, '--dry-run', '--ignore-scripts', '--prefer-online', '--fetch-retries=0', '--json'],
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 },
        );
        const [archive] = JSON.parse(output);
        if (archive?.name === npmName && archive.version === npmVersion) {
          console.log(`::notice title=npm verified::${packageSpec} archive available after ${attempt} attempt(s).`);
          return npmVersion;
        }
      } catch {
        // npm's metadata and archive endpoints can become available independently.
      }
      console.log(`npm wait ${attempt}: ${packageSpec} archive not ready…`);
      return null;
    },
    onTimeout: () => new Error(`${packageSpec} archive not on npm within ${timeoutMin} minutes`),
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
