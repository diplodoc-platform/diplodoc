# Agent Documentation for Diplodoc Metapackage

This directory contains documentation for AI coding agents working on the Diplodoc platform.

## Structure

- **`core.md`** – Core concepts, platform overview, architecture
- **`monorepo.md`** – Metapackage management, submodules, workspace packages
- **`style-and-testing.md`** – Code style, testing, commit standards
- **`dev-infrastructure.md`** – Build system, scripts, tools, CI/CD
- **`PLAN.md`** – Plan for scaling agent documentation across all packages
- **`QUESTIONS.md`** – Questions for clarification (answered)
- **`ANALYSIS.md`** – Analysis of metapackage structure and patterns
- **`TODO.md`** – Infrastructure improvements and maintenance tasks
- **`templates/`** – Templates for creating AGENTS.md in submodules and packages

## Quick Start

1. Read `core.md` for platform overview
2. Read `monorepo.md` for development workflow and **workspace dependency management** (critical!)
3. Read `style-and-testing.md` for coding standards
4. Use `templates/` when creating documentation for new packages

## Important: Workspace Dependency Management

**Critical**: When working with submodules in the metapackage, always use `--no-workspaces` flag when installing dependencies:

```bash
cd packages/your-package
npm install --no-workspaces package-name@version
npm install --no-workspaces --package-lock-only
```

This prevents version conflicts between workspace and submodule dependencies. See `monorepo.md` for details.

## Note

This directory is separate from `docs/` (user-facing documentation) to keep agent documentation separate from user documentation.

