import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

function prepare({ changed = false, existingIssue = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rt-prepare-control-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  try {
    writeFileSync(
      join(dir, 'release-train.yml'),
      JSON.stringify({
        defaults: { org: 'diplodoc-platform' },
        repos: { utils: { npm: '@diplodoc/utils' } },
      }),
    );
    writeFileSync(
      join(dir, 'deps-graph.json'),
      JSON.stringify({
        nodes: [{ repo: 'utils', npm: '@diplodoc/utils' }],
        edges: [],
        topoOrder: ['utils'],
      }),
    );
    writeFileSync(
      join(dir, 'control.json'),
      JSON.stringify({
        scope: { participants: [{ repo: 'utils', number: 1, sha: 'a'.repeat(40) }] },
      }),
    );
    writeFileSync(
      join(bin, 'gh'),
      `#!${process.execPath}
const args=process.argv.slice(2);
require('node:fs').appendFileSync(${JSON.stringify(join(dir, 'calls.jsonl'))},JSON.stringify(args)+'\\n');
if(args[0]==='pr'&&args[1]==='view')console.log(JSON.stringify({number:1,state:'OPEN',isDraft:false,baseRefName:'master',headRefName:'feature',headRefOid:${JSON.stringify((changed ? 'b' : 'a').repeat(40))},url:'https://github.com/diplodoc-platform/utils/pull/1'}));
else if(args[0]==='api'&&args[1].includes('/issues?'))console.log(JSON.stringify([{number:99,state:'closed',html_url:'https://github.com/diplodoc-platform/diplodoc/issues/99',body:'Untrusted existing state'}]));
else if(args[0]==='api'&&args[1].includes('/labels/'))console.log('{}');
else throw new Error('Unexpected write or external call '+JSON.stringify(args));
`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      process.execPath,
      [
        new URL('./prepare.js', import.meta.url).pathname,
        '--train-id',
        'rt-pr-fixture',
        '--prs',
        'utils#1',
        '--control',
        'control.json',
        ...(existingIssue ? [] : ['--no-issue', '--dry-run']),
        '--output',
        'plan.json',
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GH_TOKEN: 'fixture' },
      },
    );
    const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    return {
      ...result,
      calls,
      plan:
        result.status === 0 ? JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')) : undefined,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('prepare passes exactly the preview SHA into the durable plan', () => {
  const result = prepare();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.plan.packages[0].featurePr.expectedHead, 'a'.repeat(40));
});

test('a push between authorization and prepare fails before a plan can merge anything', () => {
  const result = prepare({ changed: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Preview head changed/);
  assert.equal(result.plan, undefined);
});

test('a new controlled Start cannot import or reopen an existing tracking issue', () => {
  const result = prepare({ existingIssue: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot restore existing tracking state/);
  assert.ok(!result.calls.some((args) => args.includes('PATCH')));
  assert.equal(result.plan, undefined);
});
