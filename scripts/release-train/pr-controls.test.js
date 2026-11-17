import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { loadYaml } from './yaml-loader.js';
import {
  APP_ID,
  OWNER,
  REQUEST_MARKER,
  PREVIEW_MARKER,
  bodyParticipants,
  digest,
  resolveScope,
  authorizeControl,
  claimStart,
  publishPreview,
} from './pr-controls.js';

const now = Date.parse('2026-11-17T09:00:00Z');
function fixture() {
  const source = { repo: 'utils', number: 1, sha: 'a'.repeat(40) };
  const pr = (repo, number, sha) => ({
    number,
    state: 'open',
    draft: false,
    user: { login: 'developer', type: 'User' },
    body: '',
    labels: [],
    base: { ref: 'master', repo: { full_name: `${OWNER}/${repo}` } },
    head: { sha, ref: 'feat/shared', repo: { full_name: `${OWNER}/${repo}` } },
  });
  const prs = { utils: pr('utils', 1, source.sha), tabs: pr('tabs', 2, 'b'.repeat(40)) };
  const config = {
    repos: { utils: { npm: '@diplodoc/utils' }, tabs: { npm: '@diplodoc/tabs' } },
    commands: { team_slug: 'team' },
  };
  const request = {
    schema: 1,
    source,
    action: 'preview',
    operator: { login: 'maintainer', id: 7 },
    buttonCheckId: 10,
    deliveryId: 'delivery-1',
    issuedAt: new Date(now).toISOString(),
  };
  const button = {
    id: 10,
    app: { id: APP_ID },
    name: 'Release Train',
    external_id: 'release-train-pr:utils:1',
    head_sha: source.sha,
    created_at: new Date(now).toISOString(),
    status: 'completed',
    conclusion: 'neutral',
  };
  const receipt = {
    id: 11,
    app: { id: APP_ID },
    name: 'Release Train request',
    head_sha: source.sha,
    external_id: 'release-train-request:delivery-1',
    status: 'completed',
    conclusion: 'neutral',
    created_at: new Date(now).toISOString(),
  };
  const env = {
    RELEASE_TRAIN_PR_CONTROLS_ENABLED: 'true',
    GITHUB_ACTOR: 'diplodoc-app[bot]',
    GITHUB_REF: 'refs/heads/master',
    GITHUB_SHA: 'c'.repeat(40),
    CONTROL_REPO: 'utils',
    CONTROL_PR: '1',
    CONTROL_CHECK_ID: '11',
    DRY_RUN: 'true',
  };
  const state = { writes: [], claims: [], denied: '', member: true };
  const api = async (route, method = 'GET', data) => {
    if (method === 'POST') {
      state.writes.push({ route, data });
      if (route.endsWith('/diplodoc/check-runs'))
        state.claims.push({ ...data, app: { id: APP_ID } });
      return { ...data, id: 12 };
    }
    if (route.endsWith('/check-runs/11'))
      return { ...receipt, output: { text: REQUEST_MARKER + JSON.stringify(request) } };
    if (route.endsWith('/check-runs/10')) return button;
    if (route.includes('/diplodoc/commits/')) return { check_runs: state.claims };
    if (route.includes('/check-runs?')) return { check_runs: [button] };
    if (route.includes('/memberships/')) return { state: state.member ? 'active' : 'pending' };
    if (route.includes('/collaborators/'))
      return {
        permission: route.includes(`/${state.denied}/`) ? 'read' : 'write',
        user: { ...request.operator, type: 'User' },
      };
    const repo = route.split('/')[3];
    if (route.includes('/pulls?')) return [prs[repo]];
    if (route.includes('/pulls/')) return prs[repo];
    throw new Error(`Unexpected route ${route}`);
  };
  return { source, prs, config, request, button, receipt, env, state, api };
}

test('only the explicit Release train section is interpreted, and malformed sections never fall back', () => {
  assert.equal(bodyParticipants('Related https://github.com/other/repo/pull/4'), null);
  assert.equal(
    bodyParticipants(
      '## Release train\n- utils#1\n- [tabs](https://github.com/diplodoc-platform/tabs/pull/2)\n## Notes\nunrelated#3',
    ).length,
    2,
  );
  for (const body of [
    '## Release train\n',
    '## Release train\nbad input',
    '## Release train\nutils#1\n## Release train\ntabs#2',
    '## Release train\nutils#1 utils#2',
  ])
    assert.throws(() => bodyParticipants(body));
});

test('branch discovery includes the origin and freezes all exact source heads', async () => {
  const f = fixture();
  const scope = await resolveScope(f.source, f.config, f.api, f.env.GITHUB_SHA);
  assert.equal(scope.mode, 'branch');
  assert.deepEqual(
    scope.participants.map((p) => p.repo),
    ['tabs', 'utils'],
  );
  assert.equal(scope.participants[1].sha, f.source.sha);
  f.prs.utils.body = '## Release train\nutils#1';
  const explicit = await resolveScope(f.source, f.config, f.api, f.env.GITHUB_SHA);
  assert.equal(explicit.mode, 'description');
  assert.equal(explicit.participants.length, 1);
});

test('preview is read-only until publishing a neutral check and cannot merge or publish packages', async () => {
  const f = fixture();
  const control = await authorizeControl(f.env, f.config, f.api, now);
  assert.equal(f.state.writes.length, 0);
  await publishPreview(
    control,
    f.api,
    'https://github.com/diplodoc-platform/diplodoc/actions/runs/12',
  );
  assert.equal(f.state.writes.length, 1);
  assert.ok(f.state.writes[0].data.output.text.startsWith(PREVIEW_MARKER));
  assert.equal(f.state.writes[0].data.actions[1].identifier, 'start-release-train');
});

for (const change of [
  'disabled',
  'actor',
  'branch',
  'expired',
  'issuer',
  'receipt-time',
  'head',
  'bot',
  'fork',
  'release',
  'candidate',
  'draft',
  'permissions',
  'team',
  'extra-scope',
  'foreign-ref',
]) {
  test(`fails closed before writes on ${change}`, async () => {
    const f = fixture();
    if (change === 'disabled') f.env.RELEASE_TRAIN_PR_CONTROLS_ENABLED = 'false';
    if (change === 'actor') f.env.GITHUB_ACTOR = 'outsider';
    if (change === 'branch') f.env.GITHUB_REF = 'refs/heads/untrusted';
    if (change === 'expired') f.request.issuedAt = new Date(now - 3600_001).toISOString();
    if (change === 'issuer') f.receipt.app.id = 1;
    if (change === 'receipt-time') f.receipt.created_at = new Date(now - 60_001).toISOString();
    if (change === 'head') f.prs.utils.head.sha = 'e'.repeat(40);
    if (change === 'bot') f.prs.utils.user.type = 'Bot';
    if (change === 'fork') f.prs.tabs.head.repo.full_name = 'outsider/tabs';
    if (change === 'release') f.prs.tabs.head.ref = 'release-please--branches--master';
    if (change === 'candidate') f.prs.tabs.head.ref = 'codex/dependency-candidate-'+'a'.repeat(16);
    if (change === 'draft') f.prs.tabs.draft = true;
    if (change === 'permissions') f.state.denied = 'tabs';
    if (change === 'team') f.state.member = false;
    if (change === 'extra-scope') f.env.EXTRA_BRANCH = 'another';
    if (change === 'foreign-ref') f.prs.utils.body = '## Release train\nother/tabs#2';
    await assert.rejects(authorizeControl(f.env, f.config, f.api, now));
    assert.equal(f.state.writes.length, 0);
  });
}

async function startFixture() {
  const f = fixture();
  const scope = await resolveScope(f.source, f.config, f.api, f.env.GITHUB_SHA);
  f.button.output = { text: PREVIEW_MARKER + JSON.stringify(scope) };
  f.request.action = 'start';
  f.env.DRY_RUN = 'false';
  f.env.TRAIN_ID = `rt-pr-${digest({ configSha: scope.configSha, participants: scope.participants }).slice(0, 24)}`;
  return f;
}

test('start rechecks the preview, uses the group concurrency key, and claims the group only once', async () => {
  const f = await startFixture();
  const control = await authorizeControl(f.env, f.config, f.api, now);
  await claimStart(control, f.api);
  await assert.rejects(claimStart(control, f.api), /already started/);
  assert.equal(f.state.writes.length, 1);
});

for (const change of ['body', 'participant', 'config', 'preview', 'key', 'purpose']) {
  test(`start rejects changed ${change} after preview`, async () => {
    const f = await startFixture();
    if (change === 'body') f.prs.utils.body = 'changed';
    if (change === 'participant') f.prs.tabs.head.sha = 'f'.repeat(40);
    if (change === 'config') f.env.GITHUB_SHA = 'f'.repeat(40);
    if (change === 'preview') f.button.output.text = 'No preview';
    if (change === 'key') f.env.TRAIN_ID = 'different-lock';
    if (change === 'purpose') f.env.DRY_RUN = 'true';
    await assert.rejects(authorizeControl(f.env, f.config, f.api, now));
    assert.equal(f.state.writes.length, 0);
  });
}

test('published check buttons obey native API label, description and identifier limits', async () => {
  const f = fixture();
  const control = await authorizeControl(f.env, f.config, f.api, now);
  const result = await publishPreview(
    control,
    f.api,
    'https://github.com/diplodoc-platform/diplodoc/actions/runs/12',
  );
  for (const action of result.actions) {
    assert.ok(action.label.length <= 20);
    assert.ok(action.identifier.length <= 20);
    assert.ok(action.description.length <= 40);
  }
});

test('different Start groups and controlled resumes serialize, while previews stay independent', () => {
  const workflow = loadYaml(new URL('../../.github/workflows/release-train.yml', import.meta.url));
  const expression = workflow.concurrency.group.match(/\$\{\{ (.*) \}\}/)[1];
  const key = (inputs) =>
    runInNewContext(expression, {
      inputs,
      github: { run_number: 1 },
      startsWith: (s, p) => String(s || '').startsWith(p),
      format: (_, n) => `run-${n}`,
    });
  assert.equal(
    key({ control_check_id: '1', dry_run: false, train_id: 'rt-pr-a' }),
    key({ control_check_id: '2', dry_run: false, train_id: 'rt-pr-b' }),
  );
  assert.equal(
    key({ control_check_id: '1', dry_run: false, train_id: 'rt-pr-a' }),
    key({ control_check_id: '', dry_run: false, train_id: 'rt-pr-b' }),
  );
  assert.notEqual(
    key({ control_check_id: '1', dry_run: true, train_id: 'rt-preview-1' }),
    key({ control_check_id: '2', dry_run: true, train_id: 'rt-preview-2' }),
  );
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.concurrency.queue, 'max');
  assert.equal(
    key({ control_check_id: '', dry_run: true, train_id: 'rt-pr-a' }),
    key({ control_check_id: '1', dry_run: false, train_id: 'rt-pr-b' }),
  );
});
