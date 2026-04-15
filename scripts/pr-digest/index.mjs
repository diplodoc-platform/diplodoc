#!/usr/bin/env node

/**
 * PR Digest entry point for GitHub (diplodoc-platform org).
 *
 * Env variables:
 *   GH_TOKEN               — GitHub API token
 *   TELEGRAM_BOT_TOKEN     — Telegram Bot API token (optional if using Messenger)
 *   TELEGRAM_CHAT_ID       — target chat / group id
 *   MESSENGER_OAUTH_TOKEN  — Yandex Messenger OAuth token (optional if using Telegram)
 *   MESSENGER_CHAT_ID      — Messenger chat ID (required if MESSENGER_OAUTH_TOKEN set)
 *   GITHUB_TELEGRAM_MAP    — (optional) JSON: { "github-login": "tg_username", … }
 *   DIGEST_SINCE           — (optional) ISO date to filter PRs created after, default "2026-03-01"
 */

import {classifyPRs, buildMessage, sendTelegram, sendMessenger} from './core.mjs';
import {collectAllPRs} from './github-adapter.mjs';

const ORG = 'diplodoc-platform';

function env(name, required = true) {
    const v = process.env[name];
    if (!v && required) {
        console.error(`Missing required env variable: ${name}`);
        process.exit(1);
    }
    return v;
}

async function main() {
    const token = env('GH_TOKEN');

    const tgToken = env('TELEGRAM_BOT_TOKEN', false);
    const tgChatId = env('TELEGRAM_CHAT_ID', false);
    const msgrToken = env('MESSENGER_OAUTH_TOKEN', false);
    const msgrChatId = env('MESSENGER_CHAT_ID', false);

    if (!tgToken && !msgrToken) {
        console.error('No messaging transport configured. Set TELEGRAM_BOT_TOKEN and/or MESSENGER_OAUTH_TOKEN + MESSENGER_CHAT_ID.');
        process.exit(1);
    }

    let tgMap = {};
    try {
        tgMap = JSON.parse(process.env.GITHUB_TELEGRAM_MAP || '{}');
    } catch {
        console.warn('Failed to parse GITHUB_TELEGRAM_MAP, ignoring');
    }

    const since = new Date(process.env.DIGEST_SINCE || '2026-03-01T00:00:00Z');

    console.log(`Starting PR digest (since: ${since.toDateString()})...`);

    const allPRs = await collectAllPRs({org: ORG, token});
    const prs = allPRs.filter((pr) => new Date(pr.createdAt) >= since);
    const digest = classifyPRs(prs);
    const total = digest.noReview.length + digest.hasIssues.length + digest.awaitingReview.length + digest.readyToMerge.length;

    if (total === 0) {
        console.log('No unreviewed PRs found. Nothing to send.');
        return;
    }

    const sends = [];

    if (tgToken && tgChatId) {
        const message = buildMessage({
            digest,
            title: 'PR Digest — diplodoc-platform',
            tgMap,
            groupByRepo: true,
            format: 'markdownv2',
        });

        console.log('--- Telegram message preview ---');
        console.log(message);
        console.log('--- End preview ---');

        sends.push(
            sendTelegram(message, {token: tgToken, chatId: tgChatId})
                .catch((err) => console.error('Telegram: failed:', err.message)),
        );
    }

    if (msgrToken && msgrChatId) {
        const message = buildMessage({
            digest,
            title: 'PR Digest — diplodoc-platform',
            tgMap,
            groupByRepo: true,
            format: 'messenger',
        });

        if (!tgToken) {
            console.log('--- Messenger message preview ---');
            console.log(message);
            console.log('--- End preview ---');
        }

        sends.push(
            sendMessenger(message, {token: msgrToken, chatId: msgrChatId})
                .catch((err) => console.error('Messenger: failed:', err.message)),
        );
    }

    await Promise.all(sends);
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
