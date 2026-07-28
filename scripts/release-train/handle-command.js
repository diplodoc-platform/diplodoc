#!/usr/bin/env node
/**
 * Issue-comment command handler for the release train.
 *
 * Invoked from .github/workflows/release-train-command.yml with the comment
 * payload in the environment. Validates the command and the author, then
 * dispatches the work; every outcome is reported back into the issue.
 */

import { readFileSync } from 'node:fs';
import { loadConfig, trainContext } from './config.js';
import {
  addCommentReaction,
  createIssueComment,
  dispatchWorkflow,
  getIssue,
  getLatestWorkflowRun,
  isTeamMember,
} from './gh.js';
import { hasLabel, parseCommand, trainIdFromLabels } from './commands.js';
import { DRIFT_LABEL, normalizeTrainId } from './tracking-issue.js';
import { parsePrRefs } from './pr-refs.js';
import { waitMs } from './poll.js';

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GH_TOKEN is required');
  process.exit(1);
}

const config = loadConfig();
const commandsCfg = config.commands || {};

const { org, issueOwner, issueRepo, targetBranch: dispatchRef } = trainContext(config);
const teamOrg = commandsCfg.team_org || org;
const teamSlug = commandsCfg.team_slug || 'team';

const eventPath = process.env.GITHUB_EVENT_PATH;
const event = eventPath ? JSON.parse(readFileSync(eventPath, 'utf8')) : null;
if (!event?.comment || !event?.issue) {
  console.log('Not an issue_comment event — nothing to do.');
  process.exit(0);
}

const [eventOwner, eventRepo] = String(process.env.GITHUB_REPOSITORY || '').split('/');
const issueNumber = event.issue.number;
const commentId = event.comment.id;
const author = event.comment.user?.login || '';

function reply(body) {
  try {
    createIssueComment(eventOwner, eventRepo, issueNumber, body, token);
  } catch (err) {
    console.warn(`::warning::Could not reply in issue #${issueNumber}: ${err.message}`);
  }
}

function reject(reason) {
  console.log(`Command rejected: ${reason}`);
  reply(`🚫 ${reason}`);
  process.exit(0);
}

const command = parseCommand(event.comment.body, {
  aliases: commandsCfg.aliases,
  actions: commandsCfg.actions,
});

if (!command) {
  console.log('No release train command in comment — nothing to do.');
  process.exit(0);
}

if (command.unknownAction) {
  reject(
    `Unknown release train command \`${command.action || '(none)'}\`. Supported: ${(commandsCfg.actions || ['retry', 'resume', 'start']).join(', ')}.`,
  );
}

// 1. The command must come from the repo that owns tracking issues.
if (eventOwner !== issueOwner || eventRepo !== issueRepo) {
  reject(`Release train commands are only accepted in ${issueOwner}/${issueRepo}.`);
}

// 2. The issue must be a release train issue.
const issue = getIssue(eventOwner, eventRepo, issueNumber, token) || event.issue;
const labels = issue.labels || [];
const isDrift = hasLabel(labels, DRIFT_LABEL);
let trainId = null;
try {
  trainId = normalizeTrainId(trainIdFromLabels(labels));
} catch (err) {
  reject(err.message);
}

if (!trainId) {
  reject('This issue has no `release-train:<id>` label — it is not a release train issue.');
}

// 3. The author must be an active member of the allowed team.
if (!isTeamMember(teamOrg, teamSlug, author, token)) {
  reject(`@${author} is not an active member of @${teamOrg}/${teamSlug} — command ignored.`);
}

addCommentReaction(eventOwner, eventRepo, commentId, 'eyes', token);

/* ---------------------------------------------------------------- *
 * Actions                                                           *
 * ---------------------------------------------------------------- */

let prs = '';
if (command.args.prs) {
  try {
    prs = parsePrRefs(command.args.prs, org)
      .map((ref) => `${ref.owner}/${ref.repo}#${ref.number}`)
      .join(',');
  } catch (err) {
    reject(`Invalid \`prs=\` argument: ${err.message}`);
  }
}

async function latestRunUrl(workflowFile) {
  await waitMs(6000);
  try {
    const run = getLatestWorkflowRun(issueOwner, issueRepo, workflowFile, dispatchRef, token);
    return run?.url || null;
  } catch {
    return null;
  }
}

async function dispatchTrain() {
  const inputs = { train_id: trainId };
  if (prs) inputs.prs = prs;

  dispatchWorkflow(issueOwner, issueRepo, 'release-train.yml', inputs, token, dispatchRef);

  const url = await latestRunUrl('release-train.yml');
  reply(
    [
      `🚂 Restart accepted for \`${trainId}\`${url ? `: ${url}` : '.'}`,
      prs ? `\nAdded PRs: ${prs}` : '',
    ]
      .join('')
      .trim(),
  );
}

async function dispatchDriftStart() {
  if (!isDrift) {
    reject('`start` is only available on a dependency drift issue.');
  }

  dispatchWorkflow(
    issueOwner,
    issueRepo,
    'release-train-drift-start.yml',
    { train_id: trainId, issue_number: String(issueNumber) },
    token,
    dispatchRef,
  );

  const url = await latestRunUrl('release-train-drift-start.yml');
  reply(`🚂 Drift start accepted for \`${trainId}\`${url ? `: ${url}` : '.'}`);
}

const action = command.canonical;

try {
  if (action === 'resume') {
    await dispatchTrain();
  } else if (action === 'start') {
    await dispatchDriftStart();
  } else {
    reject(`Unsupported action \`${command.action}\`.`);
  }
} catch (err) {
  console.error(`::error::${err.message}`);
  reply(`🚫 Could not run \`/${command.alias} ${command.action}\`: ${err.message}`);
  process.exit(1);
}
