#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { TokenManager, signAppJwt, tokenManagerFromEnv } from './app-token.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

test('signAppJwt produces a verifiable RS256 token with GitHub-legal claims', () => {
  const now = 1_800_000_000;
  const jwt = signAppJwt({ appId: 12345, privateKeyPem, now });
  const [header, payload, signature] = jwt.split('.');

  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url').toString()), {
    alg: 'RS256',
    typ: 'JWT',
  });
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.iss, '12345');
  assert.equal(claims.iat, now - 60);
  assert.ok(claims.exp - now <= 600, 'exp must stay within GitHub\'s 10 minute limit');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, 'base64url')));
});

test('signAppJwt requires credentials', () => {
  assert.throws(() => signAppJwt({ privateKeyPem }), /appId is required/);
  assert.throws(() => signAppJwt({ appId: 1 }), /privateKeyPem is required/);
});

function makeManager({ initialToken = 'workflow-token', clock = { value: 0 } } = {}) {
  let minted = 0;
  const manager = new TokenManager({
    appId: 1,
    privateKeyPem,
    owner: 'diplodoc-platform',
    initialToken,
    now: () => clock.value,
    mint: () => {
      minted += 1;
      return {
        token: `minted-${minted}`,
        expiresAt: new Date(clock.value + 60 * 60 * 1000).toISOString(),
      };
    },
  });
  return { manager, minted: () => minted, clock };
}

test('the workflow token is replaced by a tracked one on first use', () => {
  const { manager, minted } = makeManager();
  assert.equal(manager.get(), 'minted-1');
  assert.equal(minted(), 1);
});

test('a live token is reused until the refresh margin', () => {
  const { manager, minted, clock } = makeManager();
  manager.get();

  clock.value += 40 * 60 * 1000;
  assert.equal(manager.get(), 'minted-1', 'still 20 minutes of life left');
  assert.equal(minted(), 1);

  clock.value += 15 * 60 * 1000;
  assert.equal(manager.get(), 'minted-2', 'inside the 10 minute margin');
  assert.equal(minted(), 2);
});

test('every issued token stays recognised as ours', () => {
  const { manager, clock } = makeManager();
  assert.ok(manager.owns('workflow-token'));
  manager.get();
  clock.value += 60 * 60 * 1000;
  manager.get();

  assert.ok(manager.owns('workflow-token'));
  assert.ok(manager.owns('minted-1'));
  assert.ok(manager.owns('minted-2'));
  // A separately configured credential must be passed through untouched.
  assert.equal(manager.owns('approver-pat'), false);
});

test('tokenManagerFromEnv only activates with App credentials', () => {
  assert.equal(tokenManagerFromEnv({ owner: 'o', initialToken: 't', env: {} }), null);
  assert.equal(
    tokenManagerFromEnv({ owner: 'o', initialToken: 't', env: { RT_APP_ID: '1' } }),
    null,
  );
  const manager = tokenManagerFromEnv({
    owner: 'o',
    initialToken: 't',
    env: { RT_APP_ID: '1', RT_APP_PRIVATE_KEY: privateKeyPem },
  });
  assert.ok(manager instanceof TokenManager);
  assert.ok(manager.owns('t'));
});
