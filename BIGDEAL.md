# Big Deal

This file tracks significant improvements and major updates to the Diplodoc metapackage and its submodules.

## 2025

### December 2025

1. **devops/lint** — Comprehensive update and documentation
   - Implemented comprehensive test suite (34 tests: 17 unit + 17 integration)
   - Added cross-platform compatibility for Windows, macOS, and Linux
   - Expanded README.md with detailed documentation (commands, configuration, usage modes)
   - Created detailed AGENTS.md for AI agents
   - Fixed CI/CD workflow for automated testing
   - Improved error handling and validation
   - Documented metapackage vs standalone usage modes
   - Added package-lock.json management guidelines for standalone mode

2. **devops/package-template** — Complete overhaul and modernization
   - Removed static configuration files (now generated via `@diplodoc/lint init`)
   - Updated build structure to use `build/` directory with separate TypeScript config for publishing
   - Integrated Vitest as the recommended testing framework with example tests
   - Converted build script to ESM (`esbuild/build.mjs`)
   - Added GitHub templates (issue templates, PR template)
   - Added `SECURITY.md` and expanded `CONTRIBUTING.md`
   - Integrated Dependabot for automated dependency updates
   - Added security workflow for weekly audits
   - Integrated release-please for automated versioning and changelog generation
   - Added comprehensive `AGENTS.md` with template section for initialization
   - Updated all dependency versions to latest stable
   - Improved code examples and documentation

