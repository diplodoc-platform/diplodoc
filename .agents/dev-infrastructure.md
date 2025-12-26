# Agent Guide – Development Infrastructure

## Overview

This document describes the development infrastructure setup for the Diplodoc metapackage, including build systems, testing setup, code quality tools, Git workflows, and npm scripts.

## Prerequisites

- **Node.js >=22**
- **npm >=11.5.1**
- **Git**

## Build System

### Package Builds

Each package builds independently using its own build system:

- **TypeScript packages**: Use `tsc` or custom build scripts
- **Some packages**: Use `esbuild` for faster builds
- **Some packages**: Use `rspack` for web builds
- **Output directories**: `build/`, `lib/`, or `dist/`

### Nx Build Orchestration

Nx coordinates builds across packages:

```bash
# Build specific package
npx nx build @diplodoc/cli

# Build with dependencies
npx nx build @diplodoc/cli --with-deps

# Build in parallel
npx nx build @diplodoc/cli --parallel=5
```

**Features**:
- Automatic dependency resolution
- Parallel builds when possible
- Build caching (unchanged packages not rebuilt)
- Dependency graph awareness

### Build Configuration

Nx configuration in `nx.json`:
- Defines build targets
- Configures caching
- Sets up dependency relationships
- Defines input/output patterns

## Development Scripts

### Core Scripts

**`npm run bootstrap`**
- Full project setup
- Initializes git submodules
- Installs dependencies
- Resets packages
- Builds CLI
- **Use**: First time setup, after cloning

**`npm run watch`**
- Complete development environment
- Builds packages in watch mode
- Serves documentation on http://localhost:3001
- Watches for file changes
- Auto-rebuilds on changes
- **Use**: Daily development

**`npm run build`**
- Builds testpack
- **Use**: Quick build check

**`npm run test`**
- Runs testpack tests
- **Use**: Run system tests

**`npm run reset`**
- Cleans and resets everything
- Removes node_modules
- Reinstalls dependencies
- Unlinks packages
- **Flags**:
  - `--quick` / `-q`: Skip node_modules removal
  - `--no-metapackage` / `-u`: Don't reinstall metapackage deps
- **Use**: When dependencies get out of sync

**`npm run deps`**
- Dependency management
- **Commands**:
  - `npm run deps update <package>@<version>`: Update dependency
  - `--dry-run`: Preview changes
  - `--commit`: Auto-commit changes
- **Use**: Update dependencies across packages

### Git Submodule Scripts

**`npm run check-submodules`**
- Checks submodule status
- Updates `submodules.conf` file
- **Use**: Before adding/removing submodules

**`npm run add-submodules`**
- Adds/removes submodules according to `submodules.conf`
- Updates `.gitmodules`
- **Use**: After updating `submodules.conf`

**`npm run git:init`**
- Initializes git configuration
- Sets up submodules
- **Use**: Initial setup

**`npm run git:apply [branch]`**
- Applies branch to all submodules
- Default: `master`
- **Flags**: `--unsafe`: Ignore checkout failures
- **Use**: Update submodules to specific branch

**`npm run git:head`**
- Applies master branch (unsafe mode)
- **Use**: Quick update to master

### Utility Scripts

**`npm run analyze-deps`**
- Checks Node.js version compatibility
- **Use**: Verify environment compatibility

**`npm run codespaces`**
- Setup for GitHub Codespaces
- **Use**: Codespace environment setup

## Watch Mode

The `watch.js` script provides a comprehensive development environment:

### What It Does

1. **Unlinks packages**: Removes `node_modules/@diplodoc` from all workspace roots (except root)
   - Removes pre-built artifacts from npm that would interfere with local changes
   - Root `node_modules` contains source code from submodules (not installed from npm)
   - Non-root `node_modules` may contain pre-built artifacts that need to be removed
2. **Builds testpack**: Builds `@diplodoc/testpack` and all dependencies
3. **Builds documentation**: Builds testpack docs
4. **Starts server**: Serves docs on http://localhost:3001
5. **Watches for changes**: Monitors file changes
6. **Auto-rebuilds**: Rebuilds on changes via Nx
7. **Restarts server**: Restarts docs server when CLI changes

**How Changes Propagate**:
- **Workspace linking**: Helps find the correct module (not the npm version)
- **Local rebuilds**: Updates local build artifacts automatically via Nx
- Both mechanisms work together to ensure local changes are used

### Features

- **Parallel builds**: Up to 5 tasks in parallel
- **Nx daemon**: Faster change detection
- **Automatic restarts**: Server restarts on relevant changes
- **Error handling**: Shows build errors clearly

### Usage

```bash
npm run watch
```

Then:
- Edit code in `packages/` or `extensions/`
- Changes are automatically detected
- View live documentation at http://localhost:3001
- Check terminal for build status

## Testing Infrastructure

### Testpack

`devops/testpack` provides system-level testing:

**Location**: `devops/testpack/`

**Features**:
- End-to-end tests using Playwright
- Integration testing between packages
- Regression testing
- Can be run from metapackage or standalone

**Usage**:
```bash
cd devops/testpack
npm test
npm test -- --ui  # UI mode
```

**Configuration**:
- Uses Playwright for browser testing
- Tests are in `tests/` directory
- Config in `playwright.config.ts`

### Package-Level Testing

Each package has its own testing:
- **Vitest**: Recommended testing framework (preferred for new packages)
- **Jest**: Legacy testing framework (some older packages still use it, but migration to Vitest is recommended)
- **Test location**: `*.spec.ts`, `*.test.ts`, or `test/` directory

### Testing in Watch Mode

When `npm run watch` is running:
- Changes trigger automatic rebuilds
- Documentation is rebuilt
- Integration is tested via served documentation

## Code Quality Tools

### Linting

**Tool**: `@diplodoc/lint`

**Initialization**:
```bash
npx @diplodoc/lint init
```

**Usage**:
```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
```

**Configuration**:
- ESLint configurations (common, client, node)
- Prettier configuration
- Stylelint configuration
- Husky hooks
- Lint-staged

**Infrastructure Auto-Update**:
- `@diplodoc/lint` is installed as a dev dependency and configured in `prepare` scripts
- On each run, it checks the actuality of local infrastructure
- If outdated, it automatically updates/writes the infrastructure
- This approach prevents infrastructure drift at the package level
- Packages can still extend ESLint configuration at the `src` level if needed

**Exports** (from `@diplodoc/lint` package):
- `@diplodoc/lint/eslint-config` – Common ESLint config
- `@diplodoc/lint/eslint-config/client` – Client-side ESLint config
- `@diplodoc/lint/eslint-config/node` – Node.js ESLint config
- `@diplodoc/lint/prettier-config` – Prettier config
- `@diplodoc/lint/stylelint-config` – Stylelint config

**Note**: These are exports from the `@diplodoc/lint` package, not separate packages. The deprecated `@diplodoc/eslint-config` and `@diplodoc/prettier-config` packages have been merged into `@diplodoc/lint`.

### Pre-commit Hooks

Husky is configured to run:
- `lint-staged` on staged files
- Prevents commits with linting errors
- Auto-fixes issues when possible

### Type Checking

TypeScript type checking:
```bash
npm run typecheck   # In individual packages
```

## Nx Utilities

### Scripts Using Nx

Several scripts in `scripts/` use Nx:

**`nx.js`**:
- `graph()`: Gets Nx dependency graph
- `roots()`: Gets all package root directories
- `json()`: Reads JSON files

**Used by**:
- `watch.js`: For dependency resolution
- `reset.js`: For finding package roots
- `deps.js`: For package discovery

### Nx Commands

```bash
# View dependency graph
npx nx graph

# Build with dependencies
npx nx build @diplodoc/cli

# Run tests
npx nx test @diplodoc/cli

# Clear cache
npx nx reset
```

**Note**: No Nx plugins are currently configured. See `.agents/TODO.md` for tracking this improvement.

## Git Workflow

### Branch Strategy

- Uses `--ff-only` merge strategy
- Prefers fast-forward merges
- Keeps history linear

### Submodule Synchronization

- **Automatic**: GitHub workflow runs hourly to update master branches
- **Manual**: Use `npm run git:apply` to update manually
- **Process**: Submodules should be updated frequently

### Commit Standards

- **Format**: Conventional Commits
- **Language**: English only
- **Tool**: release-please for version management

## CI/CD

### GitHub Workflows

(Note: CI/CD configuration should be analyzed separately)

**Known workflows**:
- Submodule synchronization (hourly)
- Build and test on PRs
- Release management

### Release Process

**Independent Releases**:
- Packages are released independently (not synchronized)
- Each package has its own versioning system
- No coordinated version bumps across packages

**Cascading Release Process**:
When changes affect multiple packages, releases happen in dependency order:

1. Make changes in downstream package (e.g., `components`)
2. Create PR, merge to master via `--ff-only`
3. Release new version of `components`
4. Go to dependent package (e.g., `client`), install new `components` version
5. Create PR, merge to master via `--ff-only`
6. Release new version of `client`
7. Continue up the dependency chain (e.g., `cli`)

**Breaking Changes**:
- Release new major version when breaking changes occur
- Try to minimize breaking changes in critical packages (`cli`, `transform`, `components`)

**Version Management**:
- Uses **release-please** for automated releases
- Versions managed based on commit types
- `feat` → minor version bump
- `fix` → patch version bump
- Breaking changes → major version bump

## Package Management

### Workspace Configuration

Workspaces are configured in root `package.json`:
```json
{
  "workspaces": [
    "devops/*",
    "extensions/*",
    "extensions/**/example",
    "packages/*"
  ]
}
```

### Dependency Management

**Adding to single package**:
```bash
cd packages/cli
npm install package-name
```

**Adding to multiple packages**:
```bash
npm run deps update package-name@version
```

**Workspace dependencies**:
- Use `*` version for workspace packages
- Automatically linked in metapackage mode

### Dependency Updates

The `deps.js` script helps manage dependencies:

```bash
# Update dependency in all packages
npm run deps update lodash@^4.17.21

# Preview changes
npm run deps update lodash@^4.17.21 --dry-run

# Auto-commit
npm run deps update lodash@^4.17.21 --commit
```

## Development Environment

### Initial Setup

```bash
# Clone repository
git clone https://github.com/diplodoc-platform/diplodoc.git
cd diplodoc

# Bootstrap
npm run bootstrap

# Start development
npm run watch
```

### Daily Development

```bash
# Start watch mode
npm run watch

# In another terminal, work on packages
cd packages/cli
# Make changes, they're automatically picked up
```

### Troubleshooting

**Dependencies out of sync**:
```bash
npm run reset
```

**Submodules out of sync**:
```bash
npm run git:apply master
```

**Build issues**:
```bash
npm run reset
npm run bootstrap
```

## Project Structure

### Key Directories

- **`packages/`**: Core packages
- **`extensions/`**: Platform extensions
- **`devops/`**: DevOps tools
- **`actions/`**: GitHub Actions
- **`scripts/`**: Development scripts
- **`docs/`**: User documentation (special submodule)

### Important Files

- **`package.json`**: Metapackage configuration
- **`nx.json`**: Nx configuration
- **`submodules.conf`**: Submodule configuration
- **`.gitmodules`**: Git submodules (auto-generated)

## Important Notes

1. **Node.js Version**: Requires Node.js >=22
2. **npm Version**: Requires npm >=11.5.1
3. **Package Independence**: Each package should work standalone
4. **Watch Mode**: Primary development mode
5. **Reset Often**: Use `npm run reset` when things get out of sync
6. **Submodule Updates**: Should be done frequently
7. **Nx Graph**: Always check dependency graph before major changes
8. **Package Template**: `devops/package-template` is currently outdated and does not reflect the current infrastructure setup. Do not use it as a reference for creating new packages without updating it first.

