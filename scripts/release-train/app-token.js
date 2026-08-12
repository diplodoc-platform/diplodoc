#!/usr/bin/env node
/**
 * GitHub App installation tokens that outlive a long train.
 *
 * `actions/create-github-app-token` mints a token once per job and it expires
 * after an hour, while a train legitimately waits far longer (CI poll timeout
 * is 6h). Every `gh` call then fails with "Bad credentials (HTTP 401)". This
 * module re-mints the token from the App credentials, proactively before
 * expiry and once more on a 401.
 *
 * Zero dependencies: the JWT is signed with node:crypto and the two API calls
 * go through global fetch.
 *
 * Also usable as a CLI (`node app-token.js --mint`), which is how the
 * synchronous bridge works: gh.js is entirely execFileSync-based, so it cannot
 * await an async refresh.
 */

import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';

const API = 'https://api.github.com';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/**
 * RS256 JWT for App authentication. GitHub rejects an `exp` more than 10
 * minutes ahead and allows a little clock drift on `iat`.
 */
export function signAppJwt({ appId, privateKeyPem, now = Math.floor(Date.now() / 1000) }) {
  if (!appId) throw new Error('appId is required to sign an App JWT');
  if (!privateKeyPem) throw new Error('privateKeyPem is required to sign an App JWT');

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${signer.sign(privateKeyPem, 'base64url')}`;
}

async function githubJson(path, { jwt, method = 'GET' }) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'diplodoc-release-train',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub App API ${method} ${path} failed: HTTP ${response.status}`);
  }
  return response.json();
}

/** Mint an installation token for `owner`. Returns {token, expiresAt}. */
export async function mintInstallationToken({ appId, privateKeyPem, owner }) {
  const jwt = signAppJwt({ appId, privateKeyPem });
  const installation = await githubJson(`/orgs/${owner}/installation`, { jwt });
  if (!installation?.id) {
    throw new Error(`GitHub App is not installed on ${owner}`);
  }
  const result = await githubJson(`/app/installations/${installation.id}/access_tokens`, {
    jwt,
    method: 'POST',
  });
  if (!result?.token) throw new Error('GitHub App returned no installation token');
  return { token: result.token, expiresAt: result.expires_at };
}

/**
 * Synchronous mint for the execFileSync-based gh layer: re-run this file as a
 * CLI in a child process. Credentials travel through env, never argv.
 */
export function mintInstallationTokenSync({ appId, privateKeyPem, owner }) {
  const out = execFileSync(process.execPath, [new URL(import.meta.url).pathname, '--mint'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RT_APP_ID: String(appId),
      RT_APP_PRIVATE_KEY: privateKeyPem,
      RT_APP_OWNER: owner,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

/** Refresh this long before the token actually expires. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/**
 * Keeps one live installation token.
 *
 * `issued` tracks every token this manager has handed out (seeded with the
 * workflow-minted one), so gh.js can tell "our" tokens — which must be
 * transparently upgraded to the current one — from a separately configured
 * credential such as INFRA_APPROVER_PAT, which must be passed through as is.
 */
export class TokenManager {
  constructor({ appId, privateKeyPem, owner, initialToken = null, mint = mintInstallationTokenSync, now = () => Date.now() }) {
    this.appId = appId;
    this.privateKeyPem = privateKeyPem;
    this.owner = owner;
    this.mint = mint;
    this.now = now;
    this.current = initialToken;
    // The workflow-minted token's real expiry is unknown; treat it as expiring
    // now so the first get() replaces it with one whose lifetime we track.
    this.expiresAt = initialToken ? this.now() : 0;
    this.issued = new Set(initialToken ? [initialToken] : []);
  }

  owns(token) {
    return this.issued.has(token);
  }

  get() {
    if (!this.current || this.now() >= this.expiresAt - REFRESH_MARGIN_MS) {
      this.refresh();
    }
    return this.current;
  }

  refresh() {
    const { token, expiresAt } = this.mint({
      appId: this.appId,
      privateKeyPem: this.privateKeyPem,
      owner: this.owner,
    });
    this.current = token;
    this.expiresAt = expiresAt ? Date.parse(expiresAt) : this.now() + 55 * 60 * 1000;
    this.issued.add(token);
    console.log(
      `::notice title=release train::Minted GitHub App token (expires ${new Date(this.expiresAt).toISOString()})`,
    );
    return token;
  }
}

/**
 * Build a manager from the environment, or null when the App credentials are
 * not provided — callers then keep using the workflow-minted token unchanged.
 */
export function tokenManagerFromEnv({ owner, initialToken, env = process.env } = {}) {
  const appId = env.RT_APP_ID;
  const privateKeyPem = env.RT_APP_PRIVATE_KEY;
  if (!appId || !privateKeyPem) return null;
  return new TokenManager({ appId, privateKeyPem, owner, initialToken });
}

if (process.argv[2] === '--mint') {
  const result = await mintInstallationToken({
    appId: process.env.RT_APP_ID,
    privateKeyPem: process.env.RT_APP_PRIVATE_KEY,
    owner: process.env.RT_APP_OWNER,
  });
  process.stdout.write(JSON.stringify(result));
}
