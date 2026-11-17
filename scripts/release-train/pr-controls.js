/** Signed App controls for the existing release train. No PR code is executed here. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { parsePrRefs } from './pr-refs.js';
import { isBotLogin } from './gh.js';

export const APP_ID = 2126995;
export const OWNER = 'diplodoc-platform';
export const REQUEST_MARKER = 'RELEASE_TRAIN_REQUEST_V1\n';
export const PREVIEW_MARKER = 'RELEASE_TRAIN_PREVIEW_V1\n';
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SHA = /^[a-f0-9]{40}$/;
const positiveId = (value) => assert.ok(Number.isSafeInteger(value) && value > 0);
const object = (value) => {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
};

export function humanFeature(pr, owner = OWNER, repo, knownBots = []) {
  return (
    pr.state === 'open' &&
    pr.draft === false &&
    pr.user?.type === 'User' &&
    !isBotLogin(pr.user.login, knownBots) &&
    pr.base?.ref === 'master' &&
    pr.base.repo?.full_name === `${owner}/${repo}` &&
    pr.head?.repo?.full_name === `${owner}/${repo}` &&
    SHA.test(pr.head.sha) &&
    !pr.head.ref.startsWith('release-please--') &&
    !pr.head.ref.startsWith('codex/dependency-candidate-') &&
    !pr.labels?.some((label) => String(label.name).startsWith('autorelease:'))
  );
}

/** Only the designated section is executable input; unrelated PR links are ignored. */
export function bodyParticipants(body) {
  assert.ok(typeof body === 'string' && body.length <= 64 * 1024);
  const lines = body.split(/\r?\n/);
  const headings = lines.flatMap((line, index) =>
    /^## Release train\s*$/i.test(line) ? [index] : [],
  );
  assert.ok(headings.length <= 1, 'Multiple Release train sections');
  if (!headings.length) return null;
  const entries = [];
  for (const line of lines.slice(headings[0] + 1)) {
    if (/^#{1,2}\s/.test(line)) break;
    if (!line.trim()) continue;
    const entry = line.trim().replace(/^[-*]\s+/, '');
    entries.push(entry.replace(/^\[[^\]]*\]\((https:\/\/github\.com\/[^)]+)\)$/, '$1'));
  }
  assert.ok(entries.length > 0 && entries.length <= 40, 'Release train section must list 1–40 PRs');
  return parsePrRefs(entries.join(','), OWNER);
}

async function paged(api, route, field) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const response = await api(
      `${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
    );
    const items = field ? response[field] : response;
    assert.ok(Array.isArray(items));
    all.push(...items);
    if (items.length < 100) return all;
  }
  throw new Error('Release train inventory exceeds its bounded limit');
}

async function permission(api, repo, operator) {
  const result = await api(`/repos/${OWNER}/${repo}/collaborators/${operator.login}/permission`);
  assert.ok(
    ['admin', 'maintain', 'write'].includes(result.permission),
    `${repo}: operator needs write access`,
  );
  assert.equal(result.user?.login, operator.login);
  assert.equal(result.user?.id, operator.id);
  assert.equal(result.user?.type, 'User');
}

export async function resolveScope(source, config, api, configSha) {
  assert.match(configSha, SHA);
  const supported = Object.keys(config.repos).filter((repo) => config.repos[repo].npm);
  assert.ok(supported.length > 0 && supported.length <= 60);
  assert.ok(supported.includes(source.repo), 'Source is outside release-train.yml');
  const origin = await api(`/repos/${OWNER}/${source.repo}/pulls/${source.number}`);
  assert.ok(
    humanFeature(origin, OWNER, source.repo, config.capabilities?.known_bots),
    'Source must be an open, ready human feature PR',
  );
  assert.equal(origin.head.sha, source.sha, 'Source head changed');
  const refs = bodyParticipants(origin.body || '');
  const selected = refs || [];
  if (!refs) {
    for (const repo of supported.sort()) {
      const found = await paged(
        api,
        `/repos/${OWNER}/${repo}/pulls?state=open&base=master&head=${encodeURIComponent(`${OWNER}:${origin.head.ref}`)}`,
      );
      assert.ok(found.length <= 1, `${repo}: ambiguous branch matches`);
      if (found.length) selected.push({ owner: OWNER, repo, number: found[0].number });
    }
  }
  const canonical = parsePrRefs(
    [
      ...selected.map((ref) => `${ref.owner}/${ref.repo}#${ref.number}`),
      `${OWNER}/${source.repo}#${source.number}`,
    ].join(','),
    OWNER,
  );
  assert.ok(canonical.length <= 40, 'At most 40 participants');
  const participants = [];
  for (const ref of canonical) {
    assert.equal(ref.owner, OWNER, 'Only organization repositories are supported');
    assert.ok(supported.includes(ref.repo), `${ref.repo}: not a release target`);
    const pr = await api(`/repos/${OWNER}/${ref.repo}/pulls/${ref.number}`);
    assert.ok(
      humanFeature(pr, OWNER, ref.repo, config.capabilities?.known_bots),
      `${ref.repo}#${ref.number}: not a ready human feature PR`,
    );
    positiveId(pr.number);
    participants.push({ repo: ref.repo, number: ref.number, sha: pr.head.sha });
  }
  participants.sort((a, b) => a.repo.localeCompare(b.repo));
  return {
    schema: 1,
    configSha,
    source,
    bodySha256: digest(origin.body || ''),
    mode: refs ? 'description' : 'branch',
    participants,
  };
}

function readOutput(check, name, marker) {
  assert.equal(check.app?.id, APP_ID);
  assert.equal(check.name, name);
  assert.equal(check.status, 'completed');
  assert.equal(check.conclusion, 'neutral');
  const text = check.output?.text || '';
  assert.ok(text.startsWith(marker) && text.length <= 128 * 1024);
  return object(JSON.parse(text.slice(marker.length)));
}

/** Runs before prepare.js; App dispatches never impersonate a human GitHub actor. */
export async function authorizeControl(env, config, api, now = Date.now()) {
  assert.equal(env.RELEASE_TRAIN_PR_CONTROLS_ENABLED, 'true', 'PR controls are disabled');
  assert.equal(env.GITHUB_ACTOR, 'diplodoc-app[bot]');
  assert.equal(env.GITHUB_REF, 'refs/heads/master');
  assert.ok(
    !env.EXTRA_PRS && !env.EXTRA_BRANCH && !env.EXTRA_PACKAGES,
    'Controls cannot extend preview scope',
  );
  assert.match(env.CONTROL_REPO || '', /^[a-z0-9][a-z0-9-]{0,63}$/);
  const number = Number(env.CONTROL_PR);
  const checkId = Number(env.CONTROL_CHECK_ID);
  positiveId(number);
  positiveId(checkId);
  const receipt = await api(`/repos/${OWNER}/${env.CONTROL_REPO}/check-runs/${checkId}`);
  const request = readOutput(receipt, 'Release Train request', REQUEST_MARKER);
  assert.equal(request.schema, 1);
  assert.equal(request.source?.repo, env.CONTROL_REPO);
  assert.equal(request.source?.number, number);
  assert.match(request.source.sha, SHA);
  assert.equal(receipt.head_sha, request.source.sha);
  assert.equal(receipt.external_id, `release-train-request:${request.deliveryId}`);
  assert.match(request.deliveryId, /^[a-z0-9_-]{1,128}$/i);
  const time = Date.parse(request.issuedAt);
  assert.ok(
    Number.isFinite(time) && time <= now + 30_000 && now - time <= 3600_000,
    'Expired request',
  );
  assert.ok(Math.abs(Date.parse(receipt.created_at) - time) <= 60_000, 'Receipt time mismatch');
  assert.ok(['preview', 'start'].includes(request.action));
  assert.equal(env.DRY_RUN, String(request.action === 'preview'));
  const operator = object(request.operator);
  assert.match(operator.login, /^[a-z0-9][a-z0-9-]{0,38}$/i);
  assert.ok(!isBotLogin(operator.login, config.capabilities?.known_bots));
  positiveId(operator.id);
  await permission(api, 'diplodoc', operator);
  const team = config.commands || {};
  const membership = await api(
    `/orgs/${OWNER}/teams/${team.team_slug || 'team'}/memberships/${operator.login}`,
  );
  assert.equal(membership.state, 'active', 'Operator must be an active release-train team member');
  const scope = await resolveScope(request.source, config, api, env.GITHUB_SHA);
  for (const participant of scope.participants) await permission(api, participant.repo, operator);
  positiveId(request.buttonCheckId);
  const button = await api(
    `/repos/${OWNER}/${env.CONTROL_REPO}/check-runs/${request.buttonCheckId}`,
  );
  assert.equal(button.app?.id, APP_ID);
  assert.equal(button.name, 'Release Train');
  assert.equal(button.head_sha, scope.source.sha);
  assert.equal(button.external_id, `release-train-pr:${scope.source.repo}:${number}`);
  const checks = await paged(
    api,
    `/repos/${OWNER}/${env.CONTROL_REPO}/commits/${scope.source.sha}/check-runs?filter=all`,
    'check_runs',
  );
  const current = checks.filter(
    (check) =>
      check.app?.id === APP_ID &&
      check.name === button.name &&
      check.external_id === button.external_id,
  );
  assert.equal(Math.max(...current.map((check) => check.id)), button.id, 'Obsolete button');
  if (request.action === 'start') {
    const preview = readOutput(button, 'Release Train', PREVIEW_MARKER);
    assert.deepEqual(
      preview,
      scope,
      'Group, description, head or release configuration changed; preview again',
    );
    assert.ok(now - Date.parse(button.created_at) <= 3600_000, 'Preview expired');
  }
  const trainId = `rt-pr-${digest({ configSha: scope.configSha, participants: scope.participants }).slice(0, 24)}`;
  if (request.action === 'start')
    assert.equal(env.TRAIN_ID, trainId, 'Start must use the exact group concurrency key');
  return { request, scope, trainId };
}

export async function claimStart(control, api) {
  const external = `release-train-claim:${control.trainId}`;
  const checks = await paged(
    api,
    `/repos/${OWNER}/diplodoc/commits/${control.scope.configSha}/check-runs?filter=all`,
    'check_runs',
  );
  assert.ok(
    !checks.some((check) => check.app?.id === APP_ID && check.external_id === external),
    'This group was already started; inspect its tracking issue and resume explicitly',
  );
  await api(`/repos/${OWNER}/diplodoc/check-runs`, 'POST', {
    name: 'Release Train claim',
    head_sha: control.scope.configSha,
    external_id: external,
    status: 'completed',
    conclusion: 'neutral',
    output: {
      title: control.trainId,
      summary:
        'A human requested this exact group. Resume through its tracking issue; do not launch it twice.',
    },
  });
}

export async function publishPreview(control, api, runUrl) {
  const { scope } = control;
  return api(`/repos/${OWNER}/${scope.source.repo}/check-runs`, 'POST', {
    name: 'Release Train',
    head_sha: scope.source.sha,
    external_id: `release-train-pr:${scope.source.repo}:${scope.source.number}`,
    details_url: runUrl,
    status: 'completed',
    conclusion: 'neutral',
    output: {
      title: 'Review this group before starting releases',
      summary: `Selection: **${scope.mode}**. Start merges feature PRs and publishes packages using the existing train policy.\n\n${scope.participants.map((pr) => `- ${OWNER}/${pr.repo}#${pr.number} at \`${pr.sha}\``).join('\n')}\n\n[Plan and dependency order](${runUrl}). Changes require another preview.`,
      text: PREVIEW_MARKER + JSON.stringify(scope),
    },
    actions: [
      {
        label: 'Preview train',
        description: 'Refresh the exact participant list',
        identifier: 'preview-rel-train',
      },
      {
        label: 'Start Release Train',
        description: 'Merge and release this reviewed group',
        identifier: 'start-release-train',
      },
    ],
  });
}

async function main() {
  const api = async (route, method = 'GET', data) =>
    JSON.parse(
      execFileSync('gh', ['api', route, '--method', method, ...(data ? ['--input', '-'] : [])], {
        encoding: 'utf8',
        input: data ? JSON.stringify(data) : undefined,
      }) || 'null',
    );
  if (process.argv[2] === 'preview') {
    await publishPreview(
      JSON.parse(readFileSync('control.json', 'utf8')),
      api,
      `https://github.com/${OWNER}/diplodoc/actions/runs/${process.env.GITHUB_RUN_ID}`,
    );
    return;
  }
  const control = await authorizeControl(process.env, loadConfig(), api);
  await api(
    `/repos/${OWNER}/${control.scope.source.repo}/check-runs/${Number(process.env.CONTROL_CHECK_ID)}`,
    'PATCH',
    {
      details_url: `https://github.com/${OWNER}/diplodoc/actions/runs/${process.env.GITHUB_RUN_ID}`,
    },
  );
  if (control.request.action === 'start') await claimStart(control, api);
  writeFileSync('control.json', JSON.stringify(control));
  const prs = control.scope.participants.map((pr) => `${OWNER}/${pr.repo}#${pr.number}`).join(',');
  appendFileSync(process.env.GITHUB_OUTPUT, `prs=${prs}\ntrain_id=${control.trainId}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
