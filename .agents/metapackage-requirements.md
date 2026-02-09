# Requirements for Module Participation in the Metapackage

This document defines the requirements for a package or extension to participate in the Diplodoc metapackage. Use it when adding a new submodule, onboarding an existing repo, or auditing compliance.

**Reference**: [package-template](https://github.com/diplodoc-platform/package-template) in `devops/package-template` is the canonical baseline for structure, files, and scripts.

---

## Required

### 1. Infrastructure: @diplodoc/lint

- Use **@diplodoc/lint** for shared infrastructure: ESLint, Prettier, Stylelint, Git hooks, release-please, and CI workflow templates.
- Run `lint init` (new package) or `lint update` (existing) so that configs and workflows are generated/updated.
- Do **not** add deprecated packages `@diplodoc/eslint-config` or `@diplodoc/prettier-config`; their functionality is provided by `@diplodoc/lint` (subpaths `@diplodoc/lint/eslint-config`, `@diplodoc/lint/prettier-config`).

### 2. Testing: Vitest

- Use **Vitest** as the only test runner.
- **Unit tests**: next to the code under test, e.g. `src/**/*.test.ts` or `src/**/*.spec.ts` (same directory or `__tests__` next to the module).
- **Integration / feature tests**: in a single directory named **`test/`** (not `tests/`), so that generated ESLint overrides and docs stay consistent.
- Config: `vitest.config.mjs` at package root; include patterns for `test/**` and, if used, `src/**/*.test.ts` / `src/**/*.spec.ts`.

### 3. Required scripts in package.json

At least the following must exist and be runnable:

| Script | Purpose |
|--------|---------|
| `build` | Full build (typically `run-p build:*` or equivalent). |
| `build:js` (or `build:code`) | Bundle/build JS (esbuild or other). |
| `build:declarations` | Emit TypeScript declarations (e.g. `tsc --emitDeclarationOnly --outDir ./build`). |
| `build:clean` | Optional; remove build output. |
| `typecheck` | Type-check without emit: `tsc --noEmit`. |
| `test` | Run tests: `vitest run` (with `--config vitest.config.mjs` if not default). |
| `test:watch` | Optional but recommended: `vitest` (watch mode). |
| `lint` | `lint update && lint`. |
| `lint:fix` | `lint update && lint fix`. |
| `prepublishOnly` | Run before publish; must include at least typecheck, lint, test, build (e.g. `npm run typecheck && npm run lint && npm test && npm run build`). |
| `pre-commit` | `lint update && lint-staged`. |
| `prepare` | `husky` (if using Git hooks). |

Scripts invoked by CI (e.g. in `.github/workflows/tests.yml`) must exist: `typecheck`, `lint`, `test`, `build`.

### 4. Required files and layout

Align with **package-template**. The following are expected:

- **SECURITY.md** — security policy and contact for vulnerabilities (see package-template).
- **CONTRIBUTING.md** — contribution guidelines (see package-template).
- **LICENSE** — project license.
- **.github/workflows/** — at least: `tests.yml`, `security.yml`, release workflow(s), and optionally `release-please.yml`, `package-lock.yml`, `update-deps.yml` (from lint scaffolding).
- **.release-please-config.json**, **.release-please-manifest.json** — if using release-please (recommended).
- **.gitignore**, **.npmrc**, **.nvmrc** — standard root files (lint can add/update).
- **tsconfig.json** — TypeScript config; extend `@diplodoc/tsconfig` where appropriate.
- **vitest.config.mjs** — Vitest config.

Optional but recommended: **AGENTS.md** (for AI/agent guidance), **.github/ISSUE_TEMPLATE/**, **.github/pull_request_template.md**, **dependabot.yml**.

### 5. Build tool selection

Use a single convention so all packages are predictable:

- **Bundling (JS output)**  
  - Use **esbuild** for bundling (browser runtimes, Node bundles, extensions).  
  - Prefer **@diplodoc/lint/esbuild** instead of a direct `esbuild` dependency so the version is shared across the platform (see [lint README](https://github.com/diplodoc-platform/lint#pre-bundled-esbuild)).  
  - Entry: e.g. `esbuild/build.mjs` or `esbuild/build.js`, invoked as `node ./esbuild/build.mjs` (or `build.js`).

- **TypeScript declarations**  
  - Use **tsc** only for emitting `.d.ts`: `tsc --emitDeclarationOnly --outDir ./build` (optionally with `tsconfig.publish.json`).  
  - Do not use tsc for emitting JS bundles in normal package builds.

- **When to use what**  
  - **esbuild**: All packages that produce bundled JS (extensions, runtimes, libs with a single or few entry points).  
  - **tsc**: Declarations only; typecheck via `tsc --noEmit`.  
  - **Rspack / other bundlers**: Only if there is an explicit need (e.g. app-style build with specific plugins). Default is esbuild.

### 6. Engines and tooling

- Specify **engines** in package.json (e.g. `"node": ">=22"`, `"npm": ">=11.5.1"`) to match CI and docs.
- Use **TypeScript** for source; extend shared config (`@diplodoc/tsconfig`) where it fits.

---

## Recommended

- **Base on package-template**: New packages should start from `devops/package-template` (clone + `init.sh`), then add domain code and adjust configs.
- **README**: Follow the template structure (description, installation, usage, development, build output, CI, release). See `devops/package-template/README-template.md` and `README.md`.
- **test:watch** and **test:coverage** scripts for local and CI use.
- **AGENTS.md** and, for complex packages, docs in `docs/` or referenced from AGENTS.

---

## Forbidden

- **Deprecated packages**: Do not depend on `@diplodoc/eslint-config` or `@diplodoc/prettier-config`; use `@diplodoc/lint` and its subpaths.
- **Jest**: Do not use Jest; use Vitest only.
- **Webpack**: Do not use Webpack for package/extension builds; use esbuild (or the agreed bundler above).

---

## Checklist (quick audit)

- [ ] `@diplodoc/lint` in devDependencies; no `@diplodoc/eslint-config` / `@diplodoc/prettier-config`
- [ ] Vitest for tests; no Jest
- [ ] Unit tests next to source or in `test/`; integration tests in `test/` (directory name is `test/`, not `tests/`)
- [ ] Scripts: `build`, `build:js` (or equivalent), `build:declarations`, `typecheck`, `test`, `lint`, `lint:fix`, `prepublishOnly`, `pre-commit`, `prepare`
- [ ] SECURITY.md, CONTRIBUTING.md, LICENSE present; .github/workflows from lint scaffolding
- [ ] Bundling via esbuild (preferably `@diplodoc/lint/esbuild`); declarations via tsc only
- [ ] No Webpack
- [ ] README and layout aligned with package-template where applicable
