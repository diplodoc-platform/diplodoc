#!/usr/bin/env node
/**
 * Dry-run: fetch and classify PRs, print summary without sending to Telegram.
 * Usage: GH_TOKEN=... node dry-run.mjs
 * Respects DIGEST_SINCE env variable (default: "2026-03-01").
 */

import {classifyPRs, buildMessage} from './core.mjs';
import {collectAllPRs} from './github-adapter.mjs';

const ORG = 'diplodoc-platform';

const token = process.env.GH_TOKEN;
if (!token) {
    console.error('Missing required env variable: GH_TOKEN');
    process.exit(1);
}

const since = new Date(process.env.DIGEST_SINCE || '2026-03-01T00:00:00Z');

console.log(`Starting PR digest dry-run (since: ${since.toDateString()})...`);

const allPRs = await collectAllPRs({org: ORG, token});
const prs = allPRs.filter((pr) => new Date(pr.createdAt) >= since);
console.log(`\nFiltered to PRs created after ${since.toDateString()}: ${prs.length} of ${allPRs.length}`);
const digest = classifyPRs(prs);

const total = digest.noReview.length + digest.hasIssues.length + digest.awaitingReview.length + digest.readyToMerge.length;

console.log('\n=== PR Digest Dry Run ===');
console.log(`Total PRs: ${total}`);
console.log(`  🔴 No reviews:        ${digest.noReview.length}`);
console.log(`  🟠 Changes requested: ${digest.hasIssues.length}`);
console.log(`  🟡 Awaiting review:   ${digest.awaitingReview.length}`);
console.log(`  🟢 Ready to merge:    ${digest.readyToMerge.length}`);

if (total > 0) {
    const message = buildMessage({
        digest,
        title: 'PR Digest — diplodoc-platform',
        tgMap: {},
        groupByRepo: true,
    });
    console.log('\n--- Message preview ---');
    console.log(message);
    console.log('--- End preview ---');
}
