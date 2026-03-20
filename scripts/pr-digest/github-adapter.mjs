/**
 * GitHub API adapter for PR Digest.
 * Fetches PRs from all repos in a GitHub org and normalizes them to the common format.
 */

const GITHUB_API = 'https://api.github.com';

async function githubFetch(path, token) {
    const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
    const res = await fetch(url, {
        headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
        },
    });
    if (!res.ok) {
        throw new Error(`GitHub API ${res.status} ${res.statusText}: ${url}`);
    }
    return res.json();
}

async function fetchAllPages(path, token) {
    const results = [];
    let url = `${GITHUB_API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;

    while (url) {
        const res = await fetch(url, {
            headers: {
                Authorization: `token ${token}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });
        if (!res.ok) {
            throw new Error(`GitHub API ${res.status} ${res.statusText}: ${url}`);
        }
        const data = await res.json();
        results.push(...data);

        const link = res.headers.get('link');
        const next = link?.match(/<([^>]+)>;\s*rel="next"/);
        url = next ? next[1] : null;
    }

    return results;
}

async function fetchOrgRepos(org, token) {
    const repos = await fetchAllPages(`/orgs/${org}/repos`, token);
    return repos
        .filter((repo) => !repo.archived && !repo.disabled)
        .map((repo) => repo.name);
}

async function fetchOpenPRs(org, repo, token, label) {
    try {
        const pulls = await fetchAllPages(`/repos/${org}/${repo}/pulls?state=open`, token);
        return pulls.filter((pr) => !pr.draft && pr.labels.some((l) => l.name === label));
    } catch {
        console.warn(`Failed to fetch PRs for ${repo}, skipping`);
        return [];
    }
}

async function fetchReviews(org, repo, prNumber, token) {
    try {
        return await githubFetch(`/repos/${org}/${repo}/pulls/${prNumber}/reviews`, token);
    } catch {
        return [];
    }
}

function deduplicateReviews(reviews) {
    const latestByUser = new Map();
    for (const review of reviews) {
        if (!review.user) continue;
        const existing = latestByUser.get(review.user.login);
        if (!existing || new Date(review.submitted_at) > new Date(existing.submitted_at)) {
            latestByUser.set(review.user.login, review);
        }
    }
    return [...latestByUser.values()];
}

function normalizeGitHubPR(pr, reviews, repo) {
    const uniqueReviews = deduplicateReviews(reviews);
    const hasApproval = uniqueReviews.some((r) => r.state === 'APPROVED');
    const hasReviews = uniqueReviews.some((r) =>
        ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(r.state),
    );
    const hasOpenIssues = uniqueReviews.some((r) => r.state === 'CHANGES_REQUESTED');

    return {
        id: String(pr.number),
        title: pr.title,
        author: pr.user.login,
        url: pr.html_url,
        createdAt: pr.created_at,
        reviewers: (pr.requested_reviewers || []).map((r) => r.login),
        hasApproval,
        hasReviews,
        hasOpenIssues,
        openIssues: hasOpenIssues ? 1 : 0,
        resolvedIssues: 0,
        repo,
    };
}

export async function collectAllPRs({org, token, label = 'needs-review'}) {
    console.log(`Fetching repos for org: ${org}`);
    const repos = await fetchOrgRepos(org, token);
    console.log(`Found ${repos.length} active repos`);

    const allPRs = [];

    for (const repo of repos) {
        const prs = await fetchOpenPRs(org, repo, token, label);
        if (prs.length === 0) continue;

        console.log(`${repo}: ${prs.length} open non-draft PRs`);

        for (const pr of prs) {
            const reviews = await fetchReviews(org, repo, pr.number, token);
            allPRs.push(normalizeGitHubPR(pr, reviews, repo));
        }
    }

    return allPRs;
}
