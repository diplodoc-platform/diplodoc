/**
 * PR Digest Core — shared logic for classification, formatting, and delivery.
 *
 * Supports two output formats:
 *   - 'markdownv2' (default) — Telegram MarkdownV2
 *   - 'messenger' — Yandex Messenger markdown (**bold**, standard links)
 *
 * Normalized PR format expected by classifyPRs():
 * {
 *   id: string,
 *   title: string,
 *   author: string,
 *   url: string,
 *   createdAt: string,        // ISO date
 *   reviewers: string[],      // assigned reviewer logins
 *   hasApproval: boolean,
 *   hasReviews: boolean,      // any review activity at all
 *   hasOpenIssues: boolean,   // open issues / CHANGES_REQUESTED
 *   openIssues: number,       // 0 if not supported
 *   resolvedIssues: number,
 *   repo?: string,            // repo name (for multi-repo grouping)
 * }
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

export function escapeMarkdownV2(text) {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

export function daysSince(dateStr) {
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDays(days) {
    if (days === 0) return 'today';
    return `${days}d`;
}

// ─── classification ───────────────────────────────────────────────────────────

export function classifyPRs(prs) {
    const noReview = [];
    const hasIssues = [];
    const awaitingReview = [];
    const readyToMerge = [];

    for (const pr of prs) {
        const age = daysSince(pr.createdAt);
        const entry = {...pr, age};

        if (pr.hasApproval) {
            readyToMerge.push(entry);
        } else if (pr.reviewers.length === 0 || !pr.hasReviews) {
            noReview.push(entry);
        } else if (pr.hasOpenIssues) {
            hasIssues.push(entry);
        } else {
            awaitingReview.push(entry);
        }
    }

    noReview.sort((a, b) => b.age - a.age);
    hasIssues.sort((a, b) => b.age - a.age);
    awaitingReview.sort((a, b) => b.age - a.age);
    readyToMerge.sort((a, b) => b.age - a.age);

    return {noReview, hasIssues, awaitingReview, readyToMerge};
}

// ─── message formatting (Telegram MarkdownV2) ──────────────────────────────

function formatUser(login, tgMap) {
    const tg = tgMap[login];
    return tg ? `@${escapeMarkdownV2(tg)}` : escapeMarkdownV2(login);
}

function formatReviewers(reviewers, tgMap) {
    if (reviewers.length === 0) return '⚠️ _no reviewers assigned_';
    return reviewers.map((r) => formatUser(r, tgMap)).join(', ');
}

function formatPR(pr, tgMap, showAuthor) {
    const esc = escapeMarkdownV2;
    const title = `[${esc(pr.title || 'no title')}](${pr.url})`;
    const author = formatUser(pr.author, tgMap);
    const age = formatDays(pr.age);
    const reviewersStr = formatReviewers(pr.reviewers, tgMap);

    if (showAuthor) {
        const issues = `💬 ${pr.openIssues} open / ${pr.resolvedIssues} resolved`;
        return `• ${title}\n  👤 ${author}  ·  📅 ${age}  ·  ${issues}`;
    }
    return `• ${title}\n  👤 ${author}  ·  📅 ${age}  ·  👀 ${reviewersStr}`;
}

function formatReadyToMergePR(pr, tgMap) {
    const esc = escapeMarkdownV2;
    const title = `[${esc(pr.title || 'no title')}](${pr.url})`;
    const author = formatUser(pr.author, tgMap);
    const age = formatDays(pr.age);
    return `• ${title}\n  ${author}  ·  📅 ${age}`;
}

function appendSection(lines, emoji, label, prs, tgMap, {showAuthor = false, groupByRepo = false, formatFn = null} = {}) {
    if (!prs.length) return;
    lines.push(`${emoji} *${label} \\(${prs.length}\\):*`);
    lines.push('');

    const renderPR = formatFn ?? ((pr) => formatPR(pr, tgMap, showAuthor));

    if (groupByRepo) {
        const byRepo = new Map();
        for (const pr of prs) {
            const repo = pr.repo || 'unknown';
            if (!byRepo.has(repo)) byRepo.set(repo, []);
            byRepo.get(repo).push(pr);
        }
        for (const [repo, repoPrs] of [...byRepo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            lines.push(`*${escapeMarkdownV2(repo)}*`);
            for (const pr of repoPrs) {
                lines.push(renderPR(pr));
            }
            lines.push('');
        }
    } else {
        for (const pr of prs) {
            lines.push(renderPR(pr));
            lines.push('');
        }
    }
}

// ─── message formatting (Yandex Messenger) ─────────────────────────────────

function msgrFormatUser(login, userMap) {
    const mapped = userMap[login];
    return mapped ? `@${mapped}` : login;
}

function msgrFormatReviewers(reviewers, userMap) {
    if (reviewers.length === 0) return '-- no reviewers assigned --';
    return reviewers.map((r) => msgrFormatUser(r, userMap)).join(', ');
}

function msgrFormatPR(pr, userMap, showAuthor) {
    const title = `[${pr.title || 'no title'}](${pr.url})`;
    const author = msgrFormatUser(pr.author, userMap);
    const age = formatDays(pr.age);
    const reviewersStr = msgrFormatReviewers(pr.reviewers, userMap);

    if (showAuthor) {
        const issues = `${pr.openIssues} open / ${pr.resolvedIssues} resolved`;
        return `* ${title}\n  ${author}  ·  ${age}  ·  ${issues}`;
    }
    return `* ${title}\n  ${author}  ·  ${age}  ·  ${reviewersStr}`;
}

function msgrFormatReadyToMergePR(pr, userMap) {
    const title = `[${pr.title || 'no title'}](${pr.url})`;
    const author = msgrFormatUser(pr.author, userMap);
    const age = formatDays(pr.age);
    return `* ${title}\n  ${author}  ·  ${age}`;
}

function msgrAppendSection(lines, emoji, label, prs, userMap, {showAuthor = false, groupByRepo = false, formatFn = null} = {}) {
    if (!prs.length) return;
    lines.push(`${emoji} **${label} (${prs.length}):**`);
    lines.push('');

    const renderPR = formatFn ?? ((pr) => msgrFormatPR(pr, userMap, showAuthor));

    if (groupByRepo) {
        const byRepo = new Map();
        for (const pr of prs) {
            const repo = pr.repo || 'unknown';
            if (!byRepo.has(repo)) byRepo.set(repo, []);
            byRepo.get(repo).push(pr);
        }
        for (const [repo, repoPrs] of [...byRepo.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            lines.push(`**${repo}**`);
            for (const pr of repoPrs) {
                lines.push(renderPR(pr));
            }
            lines.push('');
        }
    } else {
        for (const pr of prs) {
            lines.push(renderPR(pr));
            lines.push('');
        }
    }
}

// ─── buildMessage ───────────────────────────────────────────────────────────

/**
 * Build the digest message.
 * @param {object} options
 * @param {object} options.digest - classified PRs from classifyPRs()
 * @param {string} options.title - message title
 * @param {object} [options.tgMap] - login → username mapping
 * @param {boolean} [options.groupByRepo]
 * @param {'markdownv2'|'messenger'} [options.format] - output format (default: 'markdownv2')
 */
export function buildMessage({digest, title, tgMap = {}, groupByRepo = false, format = 'markdownv2'}) {
    if (format === 'messenger') {
        return buildMessageMessenger({digest, title, userMap: tgMap, groupByRepo});
    }
    return buildMessageTelegram({digest, title, tgMap, groupByRepo});
}

function buildMessageTelegram({digest, title, tgMap, groupByRepo}) {
    const {noReview, hasIssues, awaitingReview, readyToMerge} = digest;
    const total = noReview.length + hasIssues.length + awaitingReview.length + readyToMerge.length;
    const lines = [];

    lines.push(`*📋 ${escapeMarkdownV2(title)}*`);
    lines.push('');

    const opts = {groupByRepo};
    appendSection(lines, '🔴', 'No reviews', noReview, tgMap, opts);
    appendSection(lines, '🟠', 'Changes requested', hasIssues, tgMap, {...opts, showAuthor: true});
    appendSection(lines, '🟡', 'Awaiting review', awaitingReview, tgMap, opts);
    appendSection(lines, '🟢', 'Ready to merge', readyToMerge, tgMap, {
        ...opts,
        formatFn: (pr) => formatReadyToMergePR(pr, tgMap),
    });

    lines.push(`Total PRs awaiting attention: *${total}*`);
    return lines.join('\n');
}

function buildMessageMessenger({digest, title, userMap, groupByRepo}) {
    const {noReview, hasIssues, awaitingReview, readyToMerge} = digest;
    const total = noReview.length + hasIssues.length + awaitingReview.length + readyToMerge.length;
    const lines = [];

    lines.push(`**📋 ${title}**`);
    lines.push('');

    const opts = {groupByRepo};
    msgrAppendSection(lines, '🔴', 'No reviews', noReview, userMap, opts);
    msgrAppendSection(lines, '🟠', 'Changes requested', hasIssues, userMap, {...opts, showAuthor: true});
    msgrAppendSection(lines, '🟡', 'Awaiting review', awaitingReview, userMap, opts);
    msgrAppendSection(lines, '🟢', 'Ready to merge', readyToMerge, userMap, {
        ...opts,
        formatFn: (pr) => msgrFormatReadyToMergePR(pr, userMap),
    });

    lines.push(`Total PRs awaiting attention: **${total}**`);
    return lines.join('\n');
}

// ─── telegram ─────────────────────────────────────────────────────────────────

export async function sendTelegram(text, {token, chatId}) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: true,
            disable_notification: true,
        }),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Telegram ${res.status}: ${body}`);
    }

    console.log('Telegram: digest sent.');
}

// ─── yandex messenger ───────────────────────────────────────────────────────

const MESSENGER_API = 'https://bp.mssngr.yandex.net/public';

export async function sendMessenger(text, {token, chatId}) {
    const authPrefix = token.startsWith('AQAD-') || token.startsWith('y1_') ? 'OAuthTeam' : 'OAuth';

    const res = await fetch(`${MESSENGER_API}/bot/v1/messages/sendText`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `${authPrefix} ${token}`,
        },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Messenger ${res.status}: ${body.slice(0, 200)}`);
    }

    console.log('Messenger: digest sent.');
}
