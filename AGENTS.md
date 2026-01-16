# AGENTS.md

A short index for AI coding agents working on this repository.

Most of the detailed guidance has been split into focused documents under `.agents/`:

- `.agents/core.md` – core concepts:
  - Diplodoc platform overview;
  - metapackage structure and workspace configuration;
  - submodules and workspace packages;
  - high-level architecture notes.
- `.agents/monorepo.md` – metapackage management:
  - working with submodules;
  - workspace packages structure;
  - dependency management (**⚠️ CRITICAL**: See procedure for updating `@diplodoc/*` packages);
  - build and development workflows.
- `.agents/style-and-testing.md` – style, testing, and documentation rules:
  - import organization, JSDoc style;
  - testing patterns and development workflow;
  - commit message format.
- `.agents/dev-infrastructure.md` – development infrastructure:
  - build system, testing setup;
  - code quality tools (ESLint, Prettier);
  - Git hooks, CI/CD workflows;
  - npm scripts and project structure.

Use these files as the primary reference when modifying or extending the platform.

