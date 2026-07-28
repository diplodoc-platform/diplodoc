/**
 * Parser for the `prs` release train input.
 *
 * Feature PRs no longer need a shared branch name, so participants are named
 * explicitly. Three notations are accepted:
 *
 *   cli#123
 *   diplodoc-platform/cli#123
 *   https://github.com/diplodoc-platform/cli/pull/123
 *
 * Everything here is pure so it can be unit-tested without GitHub access; the
 * values end up in `gh` argument arrays, hence the strict allowlists.
 */

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const URL_RE = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;
const SHORT_RE = /^(?:([^/\s#]+)\/)?([^/\s#]+)#(\d+)$/;

function validate(owner, repo, number, raw) {
  if (!OWNER_RE.test(owner)) {
    throw new Error(`Invalid owner in PR reference ${JSON.stringify(raw)}: ${owner}`);
  }
  if (!REPO_RE.test(repo)) {
    throw new Error(`Invalid repo in PR reference ${JSON.stringify(raw)}: ${repo}`);
  }
  const num = Number(number);
  if (!Number.isInteger(num) || num <= 0) {
    throw new Error(`Invalid PR number in reference ${JSON.stringify(raw)}: ${number}`);
  }
  return { owner, repo, number: num, raw };
}

/** Parse a single PR reference. Throws on anything unrecognized. */
export function parsePrRef(value, defaultOwner) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Empty PR reference');

  const url = raw.match(URL_RE);
  if (url) return validate(url[1], url[2], url[3], raw);

  const short = raw.match(SHORT_RE);
  if (short) return validate(short[1] || defaultOwner, short[2], short[3], raw);

  throw new Error(
    `Unrecognized PR reference ${JSON.stringify(raw)} — use repo#123, owner/repo#123 or a PR URL`,
  );
}

/**
 * Parse the comma/whitespace-separated `prs` input.
 *
 * Duplicate references to the same PR collapse; two different PRs in the same
 * repo are rejected because a repo can only have one participant per train.
 */
export function parsePrRefs(input, defaultOwner) {
  const parts = String(input ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const byRepo = new Map();
  for (const part of parts) {
    const ref = parsePrRef(part, defaultOwner);
    const key = `${ref.owner}/${ref.repo}`.toLowerCase();
    const seen = byRepo.get(key);
    if (seen && seen.number !== ref.number) {
      throw new Error(
        `Conflicting PRs for ${key} in prs input: #${seen.number} and #${ref.number} — one PR per repo per train`,
      );
    }
    if (!seen) byRepo.set(key, ref);
  }

  return [...byRepo.values()];
}

export function formatPrRef({ owner, repo, number }) {
  return `${owner}/${repo}#${number}`;
}
