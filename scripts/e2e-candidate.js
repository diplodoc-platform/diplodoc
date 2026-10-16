import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const METAPACKAGE = "diplodoc-platform/diplodoc";
const SHA = /^[a-f0-9]{40}$/;

/** Bind an external caller to one registered submodule at its exact event SHA. */
export function bindCandidate(env, root = process.cwd(), git = runGit) {
  const repository = env.E2E_CANDIDATE_REPOSITORY || "";
  const sha = env.E2E_CANDIDATE_SHA || "";
  const external = env.E2E_CALLER_REPOSITORY !== METAPACKAGE;
  assert.ok(repository || !sha, "candidate_sha requires candidate_repository");
  if (!repository) {
    assert.ok(!external, "External callers must identify their candidate");
    return {
      metapackageSha: git(["rev-parse", "HEAD"], root),
      candidate: null,
    };
  }
  assert.match(repository, /^diplodoc-platform\/[a-z0-9][a-z0-9-]*$/);
  assert.match(sha, SHA, "A full lowercase candidate SHA is required");
  assert.ok(
    !env.E2E_SUBMODULES_OVERRIDE,
    "Branch and exact-SHA overrides cannot be combined",
  );
  if (external) {
    assert.equal(
      repository,
      env.E2E_CALLER_REPOSITORY,
      "Candidate must be the caller repository",
    );
    assert.equal(
      sha,
      env.E2E_EXPECTED_SHA,
      "Candidate must match the caller event SHA",
    );
  }

  const paths = git(
    ["config", "-f", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    root,
  );
  const matches = [];
  for (const line of paths.split("\n")) {
    const match = /^(submodule\..*)\.path\s+(.+)$/.exec(line);
    assert.ok(match, "Malformed submodule path entry");
    const url = git(
      ["config", "-f", ".gitmodules", "--get", `${match[1]}.url`],
      root,
    );
    if (
      url === `git@github.com:${repository}.git` ||
      url === `https://github.com/${repository}.git`
    ) {
      matches.push(match[2]);
    }
  }
  assert.equal(
    matches.length,
    1,
    "Candidate must map to exactly one registered submodule",
  );
  const path = matches[0];
  assert.ok(
    !isAbsolute(path) &&
      !path.split(/[\\/]/).some((part) => part === ".." || part === "."),
  );
  const directory = resolve(root, path);
  assert.ok(
    directory.startsWith(resolve(root) + sep),
    "Submodule path escapes the metapackage",
  );
  // Public HTTPS fetch needs neither a persisted checkout token nor an SSH key.
  git(
    [
      "fetch",
      "--no-tags",
      "--depth=1",
      `https://github.com/${repository}.git`,
      sha,
    ],
    directory,
  );
  git(["checkout", "--detach", "FETCH_HEAD"], directory);
  assert.equal(
    git(["rev-parse", "HEAD"], directory),
    sha,
    "Checked-out candidate SHA mismatch",
  );
  return {
    metapackageSha: git(["rev-parse", "HEAD"], root),
    candidate: { repository, path, sha },
  };
}

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const proof = bindCandidate(process.env);
  writeFileSync("e2e-source.json", JSON.stringify(proof, null, 2) + "\n", {
    flag: "wx",
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Source identity:\n\n\`\`\`json\n${JSON.stringify(proof, null, 2)}\n\`\`\`\n`,
    );
  }
}
