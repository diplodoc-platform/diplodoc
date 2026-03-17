#!/usr/bin/env node

const ORG = 'diplodoc-platform';
const GITHUB_API = 'https://api.github.com';
const TELEGRAM_API = 'https://api.telegram.org';
const DIGEST_LABEL = process.env.DIGEST_LABEL || 'needs-review';

const GITHUB_TOKEN = process.env.GH_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// GitHub login -> Telegram username mapping (JSON string)
// Example: {"octocat": "tg_octocat", "user2": "tg_user2"}
const GITHUB_TELEGRAM_MAP = (() => {
    try {
        return JSON.parse(process.env.GITHUB_TELEGRAM_MAP || '{}');
    } catch {
        console.warn('Failed to parse GITHUB_TELEGRAM_MAP, ignoring');
        return {};
    }
})();

if (!GITHUB_TOKEN) {
    console.error('GH_TOKEN is required');
    process.exit(1);
}

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required');
    process.exit(1);
}

async function githubFetch(path) {
    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    const response = await fetch(url, {
        headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github.v3+json',
        },
    });

    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} for ${path}`);
    }

    return response.json();
}

async function fetchAllPages(path) {
    const results = [];
    let url = `${GITHUB_API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;

    while (url) {
        const response = await fetch(url, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText} for ${url}`);
        }

        const data = await response.json();
        results.push(...data);

        const link = response.headers.get('link');
        const next = link?.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : null;
    }

    return results;
}

async function getOrgRepos() {
    const repos = await fetchAllPages(`/orgs/${ORG}/repos`);
    return repos
        .filter((repo) => !repo.archived && !repo.disabled)
        .map((repo) => repo.name);
}

async function getOpenPRs(repo) {
    try {
        const pulls = await fetchAllPages(`/repos/${ORG}/${repo}/pulls?state=open`);
        return pulls.filter(
            (pr) => !pr.draft && pr.labels.some((l) => l.name === DIGEST_LABEL),
        );
    } catch {
        console.warn(`Failed to fetch PRs for ${repo}, skipping`);
        return [];
    }
}

async function getReviews(repo, prNumber) {
    try {
        const reviews = await githubFetch(`/repos/${ORG}/${repo}/pulls/${prNumber}/reviews`);
        return reviews;
    } catch {
        return [];
    }
}

function daysAgo(dateString) {
    const created = new Date(dateString);
    const now = new Date();
    return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

function formatDays(days) {
    if (days === 0) return 'сегодня';
    if (days === 1) return '1 дн.';
    return `${days} дн.`;
}

function escapeMarkdown(text) {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function formatUser(githubLogin) {
    const tgUsername = GITHUB_TELEGRAM_MAP[githubLogin];
    if (tgUsername) {
        return `@${escapeMarkdown(tgUsername)}`;
    }
    return escapeMarkdown(githubLogin);
}

function formatReviewers(reviewers) {
    if (reviewers.length === 0) {
        return '⚠️ никто не назначен';
    }
    return reviewers.map((r) => formatUser(r)).join(', ');
}

async function collectDigest() {
    console.log(`Fetching repos for org: ${ORG}`);
    const repos = await getOrgRepos();
    console.log(`Found ${repos.length} active repos`);

    const noReview = {}; // repo -> PRs with zero reviews
    const pendingApprove = {}; // repo -> PRs with reviews but no approve

    for (const repo of repos) {
        const prs = await getOpenPRs(repo);
        if (prs.length === 0) continue;

        console.log(`${repo}: ${prs.length} open non-draft PRs`);

        for (const pr of prs) {
            const reviews = await getReviews(repo, pr.number);

            // Deduplicate reviews by user — keep only the latest review per user
            const latestByUser = new Map();
            for (const review of reviews) {
                if (!review.user) continue;
                const existing = latestByUser.get(review.user.login);
                if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
                    latestByUser.set(review.user.login, review);
                }
            }

            const uniqueReviews = [...latestByUser.values()];
            const hasApproval = uniqueReviews.some((r) => r.state === 'APPROVED');
            const hasAnyReview = uniqueReviews.some((r) =>
                ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(r.state),
            );

            const reviewers = (pr.requested_reviewers || []).map((r) => r.login);

            const prInfo = {
                number: pr.number,
                title: pr.title,
                author: pr.user.login,
                reviewers,
                url: pr.html_url,
                days: daysAgo(pr.created_at),
            };

            if (!hasAnyReview) {
                if (!noReview[repo]) noReview[repo] = [];
                noReview[repo].push(prInfo);
            } else if (!hasApproval) {
                if (!pendingApprove[repo]) pendingApprove[repo] = [];
                pendingApprove[repo].push(prInfo);
            }
        }
    }

    return {noReview, pendingApprove};
}

function buildMessage({noReview, pendingApprove}) {
    const noReviewCount = Object.values(noReview).reduce((sum, prs) => sum + prs.length, 0);
    const pendingCount = Object.values(pendingApprove).reduce((sum, prs) => sum + prs.length, 0);
    const total = noReviewCount + pendingCount;

    if (total === 0) {
        return null;
    }

    const date = new Date().toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });

    const lines = [];
    lines.push(`📋 *Дайджест PR — ${escapeMarkdown(date)}*`);
    lines.push('');

    if (noReviewCount > 0) {
        lines.push(`🔴 *Без ревью \\(${noReviewCount}\\):*`);
        lines.push('');

        for (const [repo, prs] of Object.entries(noReview).sort()) {
            lines.push(`*${escapeMarkdown(repo)}*`);
            for (const pr of prs.sort((a, b) => b.days - a.days)) {
                const title = escapeMarkdown(pr.title);
                const age = escapeMarkdown(formatDays(pr.days));
                lines.push(
                    `  • [\\#${pr.number} ${title}](${pr.url}) — ${formatReviewers(pr.reviewers)} \\(${age}\\)`,
                );
            }
            lines.push('');
        }
    }

    if (pendingCount > 0) {
        lines.push(`🟡 *Ждут approve \\(${pendingCount}\\):*`);
        lines.push('');

        for (const [repo, prs] of Object.entries(pendingApprove).sort()) {
            lines.push(`*${escapeMarkdown(repo)}*`);
            for (const pr of prs.sort((a, b) => b.days - a.days)) {
                const title = escapeMarkdown(pr.title);
                const age = escapeMarkdown(formatDays(pr.days));
                lines.push(
                    `  • [\\#${pr.number} ${title}](${pr.url}) — ${formatReviewers(pr.reviewers)} \\(${age}\\)`,
                );
            }
            lines.push('');
        }
    }

    lines.push(`*Итого: ${total} PR ждут внимания*`);

    return lines.join('\n');
}

async function sendTelegram(text) {
    const url = `${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: true,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Telegram API error: ${response.status} ${body}`);
    }

    console.log('Message sent to Telegram');
}

async function main() {
    console.log(`Starting PR digest (label: ${DIGEST_LABEL})...`);

    const digest = await collectDigest();
    const message = buildMessage(digest);

    if (!message) {
        console.log('No unreviewed PRs found. Nothing to send.');
        return;
    }

    console.log('--- Message preview ---');
    console.log(message);
    console.log('--- End preview ---');

    await sendTelegram(message);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
