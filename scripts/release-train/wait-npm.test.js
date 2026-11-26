import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForNpmPackage } from './wait-npm.js';

const name = '@diplodoc/utils';
const version = '2.3.7';

test('waits for the npm archive when the published version is already visible', async () => {
  const calls = [];
  const result = await waitForNpmPackage(name, `v${version}`, 15, {
    execFileSync: (command, args) => {
      calls.push([command, args]);
      if (calls.length === 1) throw new Error('npm ERR! code E404');
      return JSON.stringify([{ name, version }]);
    },
    pollUntil: async ({ check }) => {
      assert.equal(await check(1), null);
      return check(2);
    },
  });

  assert.equal(result, version);
  const pack = [
    'pack', `${name}@${version}`, '--dry-run', '--ignore-scripts', '--prefer-online', '--fetch-retries=0', '--json',
  ];
  assert.deepEqual(calls, [['npm', pack], ['npm', pack]]);
});

test('a different archived version does not satisfy the wait', async () => {
  await assert.rejects(waitForNpmPackage(name, version, 15, {
    execFileSync: () => JSON.stringify([{ name, version: '2.3.6' }]),
    pollUntil: async ({ check, onTimeout }) => {
      assert.equal(await check(1), null);
      throw onTimeout();
    },
  }), /2\.3\.7 archive not on npm within 15 minutes/);
});
