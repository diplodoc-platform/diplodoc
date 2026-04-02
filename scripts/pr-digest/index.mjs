#!/usr/bin/env node

/**
 * PR Digest entry point for GitHub (diplodoc-platform org).
 *
 * Env variables:
 *   GH_TOKEN              — GitHub API token
 *   TELEGRAM_BOT_TOKEN    — Telegram Bot API token
 *   TELEGRAM_CHAT_ID      — target chat / group id
 *   GITHUB_TELEGRAM_MAP   — (optional) JSON: { "github-login": "tg_username", … }
 */

import {classifyPRs, buildMessage, sendTelegram} from './core.mjs';
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
    const telegramToken = env('TELEGRAM_BOT_TOKEN');
    const chatId = env('TELEGRAM_CHAT_ID');
    let tgMap = {};
    try {
        tgMap = JSON.parse(process.env.GITHUB_TELEGRAM_MAP || '{}');
    } catch {
        console.warn('Failed to parse GITHUB_TELEGRAM_MAP, ignoring');
    }

    console.log('Starting PR digest...');

    const prs = await collectAllPRs({org: ORG, token});
    const digest = classifyPRs(prs);
    const total = digest.noReview.length + digest.hasIssues.length + digest.awaitingReview.length + digest.readyToMerge.length;

    if (total === 0) {
        console.log('No unreviewed PRs found. Nothing to send.');
        return;
    }

    const message = buildMessage({
        digest,
        title: 'PR Digest — diplodoc-platform',
        tgMap,
        groupByRepo: true,
    });

    console.log('--- Message preview ---');
    console.log(message);
    console.log('--- End preview ---');

    await sendTelegram(message, {token: telegramToken, chatId});
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
