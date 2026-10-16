import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { bindCandidate } from "./e2e-candidate.js";

const sha = "b32be50ed523e3f8033bfbd80a9955328181397b";
const repository = "diplodoc-platform/tabs-extension";
const baseEnv = {
  E2E_CANDIDATE_REPOSITORY: repository,
  E2E_CANDIDATE_SHA: sha,
  E2E_CALLER_REPOSITORY: repository,
  E2E_EXPECTED_SHA: sha,
};

function fixtureGit({
  path = "extensions/tabs",
  actualSha = sha,
  url = `git@github.com:${repository}.git`,
} = {}) {
  const calls = [];
  return {
    calls,
    git(args, cwd) {
      calls.push({ args, cwd });
      if (args.includes("--get-regexp")) return `submodule.tabs.path ${path}`;
      if (args.includes("--get")) return url;
      if (args[0] === "rev-parse")
        return cwd === "/workspace" ? "a".repeat(40) : actualSha;
      return "";
    },
  };
}

test("external caller selects only its mapped submodule and full event SHA", () => {
  const { git, calls } = fixtureGit();
  assert.deepEqual(bindCandidate(baseEnv, "/workspace", git), {
    metapackageSha: "a".repeat(40),
    candidate: { repository, path: "extensions/tabs", sha },
  });
  assert.deepEqual(
    calls.find(({ args }) => args[0] === "fetch"),
    {
      args: [
        "fetch",
        "--no-tags",
        "--depth=1",
        `https://github.com/${repository}.git`,
        sha,
      ],
      cwd: "/workspace/extensions/tabs",
    },
  );
});

for (const [name, changes] of [
  [
    "missing candidate",
    { E2E_CANDIDATE_REPOSITORY: "", E2E_CANDIDATE_SHA: "" },
  ],
  ["missing repository", { E2E_CANDIDATE_REPOSITORY: "" }],
  ["missing SHA", { E2E_CANDIDATE_SHA: "" }],
  ["short SHA", { E2E_CANDIDATE_SHA: "b32be50" }],
  ["branch instead of SHA", { E2E_CANDIDATE_SHA: "master" }],
  ["shell syntax", { E2E_CANDIDATE_SHA: "$(touch /tmp/forbidden)" }],
  [
    "different repository",
    { E2E_CANDIDATE_REPOSITORY: "diplodoc-platform/transform" },
  ],
  ["different event SHA", { E2E_EXPECTED_SHA: "c".repeat(40) }],
  [
    "foreign organization",
    { E2E_CANDIDATE_REPOSITORY: "other/tabs-extension" },
  ],
  ["mixed overrides", { E2E_SUBMODULES_OVERRIDE: "feature" }],
]) {
  test(`rejects ${name} before invoking git`, () => {
    const { git, calls } = fixtureGit();
    assert.throws(() =>
      bindCandidate({ ...baseEnv, ...changes }, "/workspace", git),
    );
    assert.equal(calls.length, 0);
  });
}

for (const path of [
  "../outside",
  "/outside",
  "extensions/../outside",
  "extensions\\..\\outside",
]) {
  test(`rejects unsafe mapped path ${path}`, () => {
    const { git, calls } = fixtureGit({ path });
    assert.throws(() => bindCandidate(baseEnv, "/workspace", git));
    assert.ok(!calls.some(({ args }) => args[0] === "fetch"));
  });
}

test("rejects unregistered repositories and mismatched fetched commits", () => {
  assert.throws(() =>
    bindCandidate(
      baseEnv,
      "/workspace",
      fixtureGit({ url: "https://example.com/tabs.git" }).git,
    ),
  );
  assert.throws(() =>
    bindCandidate(
      baseEnv,
      "/workspace",
      fixtureGit({ actualSha: "c".repeat(40) }).git,
    ),
  );
});

test("ordinary metapackage runs preserve the pinned baseline without a candidate", () => {
  const { git, calls } = fixtureGit();
  assert.equal(
    bindCandidate(
      { E2E_CALLER_REPOSITORY: "diplodoc-platform/diplodoc" },
      "/workspace",
      git,
    ).candidate,
    null,
  );
  assert.equal(calls.length, 1);
});

test("real git fetch selects exact candidate bytes instead of the moving branch tip", () => {
  const root = mkdtempSync(join(tmpdir(), "e2e-candidate-"));
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git(root, "init", "-q");
    const origin = join(root, "origin");
    mkdirSync(origin);
    git(origin, "init", "-q");
    git(origin, "config", "user.name", "E2E test");
    git(origin, "config", "user.email", "e2e@example.invalid");
    writeFileSync(join(origin, "candidate.txt"), "candidate\n");
    git(origin, "add", ".");
    git(origin, "commit", "-qm", "candidate");
    const candidateSha = git(origin, "rev-parse", "HEAD");
    writeFileSync(join(origin, "candidate.txt"), "later branch tip\n");
    git(origin, "commit", "-qam", "later");
    mkdirSync(join(root, "extensions"));
    git(root, "clone", "-q", origin, "extensions/tabs");
    git(
      root,
      "config",
      "-f",
      ".gitmodules",
      "submodule.tabs.path",
      "extensions/tabs",
    );
    git(
      root,
      "config",
      "-f",
      ".gitmodules",
      "submodule.tabs.url",
      `https://github.com/${repository}.git`,
    );
    git(
      root,
      "-c",
      "user.name=E2E test",
      "-c",
      "user.email=e2e@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "baseline",
    );
    const localGit = (args, cwd) => {
      // Exercise real Git without making this fixture contact GitHub.
      const localArgs =
        args[0] === "fetch"
          ? [...args.slice(0, 3), origin, ...args.slice(4)]
          : args;
      return git(cwd, ...localArgs);
    };
    const proof = bindCandidate(
      {
        ...baseEnv,
        E2E_CANDIDATE_SHA: candidateSha,
        E2E_EXPECTED_SHA: candidateSha,
      },
      root,
      localGit,
    );
    assert.equal(proof.candidate.sha, candidateSha);
    assert.equal(
      readFileSync(join(root, "extensions/tabs/candidate.txt"), "utf8"),
      "candidate\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reusable E2E runs read-only without secrets and preserves browser report evidence", () => {
  const source = readFileSync(
    new URL("../.github/workflows/e2e-tests.yaml", import.meta.url),
    "utf8",
  );
  assert.match(source, /permissions:\s+contents: read/);
  assert.match(source, /repository: diplodoc-platform\/diplodoc/);
  assert.match(source, /persist-credentials: false/);
  assert.doesNotMatch(source, /secrets\.|pull_request_target/);
  assert.equal((source.match(/candidate_repository:/g) || []).length, 2);
  assert.equal((source.match(/candidate_sha:/g) || []).length, 2);
  assert.ok(
    source.indexOf("run: node scripts/e2e-candidate.js") <
      source.indexOf("- name: Setup node_modules"),
  );
  assert.match(source, /run: npm run test/);
});
