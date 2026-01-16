# Agent Guide – Metapackage Management

## Overview

This document describes how to work with the Diplodoc metapackage structure, including submodules, workspace packages, dependency management, and development workflows.

## Submodules in the Metapackage

### All Packages are Submodules

**Important**: In the Diplodoc metapackage, **ALL packages, extensions, and devops tools are submodules** (separate Git repositories). There are no "workspace packages" in the traditional sense - everything is a submodule.

**Submodule Characteristics**:
- Separate Git repositories
- Have their own Git history
- Can be cloned independently
- Are synchronized with the metapackage via Git submodules
- Should work standalone without metapackage context
- Total: 39 submodules (13 extensions + 12 packages + 7 devops + 6 actions + 1 docs)

### NPM Workspaces for Development

Even though all packages are submodules, npm workspaces are used to:
- Link all submodules together in the metapackage
- Share `node_modules` at the root level
- Automatically link `@diplodoc/*` packages
- Enable coordinated development across packages
- Provide shared build tools and configurations

**Key Principle**: Each submodule is a standalone unit that can be developed independently, but the metapackage provides infrastructure for collaborative development.

## Development Modes

### Mode 1: Full Metapackage Development

When working in the metapackage root:

```bash
# All packages are linked in root node_modules
npm install

# Changes in one package are immediately available to others
# via workspace linking
```

**Benefits**:
- All packages available in one place
- Changes propagate automatically
- Easy to test cross-package changes
- Full Nx dependency graph available

**Use when**:
- Working on multiple packages
- Testing integration between packages
- Setting up initial development environment

### Mode 2: Standalone Package Development

When working in an individual package:

```bash
cd packages/cli
npm install --no-workspaces

# Package works independently
npm run build
npm test
```

**Benefits**:
- Package can be developed without metapackage
- Faster setup for single-package work
- Tests package's standalone capability

**Use when**:
- Working on a single package
- Verifying package independence
- Quick fixes or small changes

## Build System

### Individual Package Builds

Each package builds independently:

```bash
# From metapackage root
npx nx build @diplodoc/cli
npx nx build @diplodoc/transform

# From package directory
cd packages/cli
npm run build
```

### Build Order

Nx automatically determines build order based on dependency graph:
- Dependencies are built before dependents
- Parallel builds when possible
- Caching for unchanged packages

### Build Outputs

Packages output to standard directories:
- `build/` – compiled JavaScript
- `lib/` – library output
- `dist/` – distribution files

## Watch Mode

The `npm run watch` command provides a complete development environment:

```bash
npm run watch
```

**What it does**:
1. Unlinks non-local `@diplodoc` packages from all workspace roots
2. Builds `@diplodoc/testpack` and dependencies
3. Builds testpack documentation
4. Serves documentation on http://localhost:3001
5. Watches for file changes and automatically rebuilds
6. Restarts documentation server when CLI changes are detected

**Key Features**:
- Automatic rebuilds on file changes
- Hot reloading for documentation
- Parallel builds (up to 5 tasks)
- Nx daemon for faster change detection

**Usage**:
- Start once: `npm run watch`
- Edit code in `packages/` or `extensions/`
- Changes are automatically detected and rebuilt
- View live documentation at http://localhost:3001

## Dependency Management

### ⚠️ CRITICAL: Updating @diplodoc/* Packages in Submodules

**CRITICAL PROCEDURE**: When updating `@diplodoc/*` packages (like `@diplodoc/lint`, `@diplodoc/tsconfig`) in a submodule while working in metapackage mode, **ALWAYS** use this two-step procedure:

```bash
# Step 1: Install through workspace (WITHOUT --no-workspaces)
cd packages/liquid  # or any submodule
npm install @diplodoc/lint@latest

# Step 2: Regenerate package-lock.json for standalone mode (WITH --no-workspaces)
npm install --no-workspaces --package-lock-only

# Step 3: Update configuration (if applicable)
npx @diplodoc/lint update
```

**Why this two-step procedure?**
- **Step 1** installs through workspace, ensuring proper linking in metapackage mode
- **Step 2** regenerates `package-lock.json` without workspace context, making it valid for standalone mode
- **Step 3** updates any auto-generated configuration files

**Common mistake to avoid**: ❌ **DO NOT** use `npm install --no-workspaces @diplodoc/lint@latest` - this skips workspace linking and breaks metapackage mode.

**This procedure is especially important for**:
- `@diplodoc/lint` - updates linting configuration
- `@diplodoc/tsconfig` - updates TypeScript configuration
- Other `@diplodoc/*` infrastructure packages

**Example**: Updating `@diplodoc/lint` in `packages/liquid`:
```bash
cd packages/liquid
npm install @diplodoc/lint@1.7.0
npm install --no-workspaces --package-lock-only
npx @diplodoc/lint update
```

---

### Adding Dependencies

**To a specific package**:
```bash
cd packages/cli
npm install package-name
```

**Important: Package Lock Management for Submodules**

Since all packages are submodules that can work standalone, when adding/updating dependencies in a submodule, you **must** use `--no-workspaces` flag to avoid workspace conflicts:

```bash
# Install/update dependencies in a submodule
cd packages/liquid  # or any submodule
npm install --no-workspaces package-name@version

# After installation, regenerate package-lock.json for standalone mode
npm install --no-workspaces --package-lock-only
```

**Why `--no-workspaces` is critical**:
- In workspace mode, npm may install dependencies from root `node_modules` or other packages
- This can cause version conflicts (e.g., vitest@3.1.1 in workspace vs vitest@^2.0.0 in package.json)
- Using `--no-workspaces` ensures dependencies are installed locally to the submodule
- The `--package-lock-only` flag regenerates `package-lock.json` without workspace context, making it valid for standalone mode

**Always use this pattern when**:
- Adding new dependencies to a submodule
- Updating dependencies in a submodule
- The submodule needs to work in both metapackage and standalone modes
- You see version conflicts between workspace and submodule dependencies

**Example**: When migrating from Jest to Vitest:
```bash
cd packages/liquid
npm install --no-workspaces vitest@^2.0.0 @vitest/coverage-v8@^2.0.0
npm install --no-workspaces --package-lock-only
```

**To multiple packages** (using deps script):
```bash
npm run deps update package-name@version
npm run deps update package-name@version --commit  # Auto-commit
npm run deps update package-name@version --dry-run  # Preview only
```

**Note**: After using `deps.js`, you may need to regenerate `package-lock.json` in affected submodules using `--no-workspaces --package-lock-only`.

### Updating Dependencies

The `deps.js` script helps update dependencies across packages:

```bash
# Update a dependency in all packages that use it
npm run deps update lodash@^4.17.21

# Preview changes without applying
npm run deps update lodash@^4.17.21 --dry-run

# Auto-commit changes
npm run deps update lodash@^4.17.21 --commit
```

### Updating a Package in a Submodule (Metapackage Mode)

**Note**: For `@diplodoc/*` packages, see the [CRITICAL procedure above](#-critical-updating-diplodoc-packages-in-submodules).

For other packages, use the standard procedure with `--no-workspaces`:

### Workspace Dependencies

Packages can depend on other workspace packages:

```json
{
  "dependencies": {
    "@diplodoc/transform": "*"
  }
}
```

When installed in metapackage mode, these are linked automatically.

## Nx Integration

### Dependency Graph

View the dependency graph:
```bash
npx nx graph
```

### Build with Dependencies

Nx automatically builds dependencies:
```bash
npx nx build @diplodoc/cli
# Automatically builds all dependencies first
```

### Caching

Nx caches build outputs:
- Unchanged packages are not rebuilt
- Cache is based on file hashes
- Cache can be cleared: `npx nx reset`

### Scripts Using Nx

Several scripts in `scripts/` use Nx:
- `nx.js` – utilities for working with Nx graph
- `watch.js` – uses Nx for dependency resolution
- `reset.js` – uses Nx to find all package roots

## Submodule Workflow

### Initial Setup

```bash
# Initialize submodules
npm run git:init

# Apply submodules (checkout master)
npm run git:apply
```

### Updating Submodules

Submodules are automatically updated hourly via GitHub workflow, but you can manually update:

```bash
# Check submodule status
npm run check-submodules

# Apply latest changes from master
npm run git:apply master

# Apply specific branch (unsafe mode ignores failures)
npm run git:apply feature-branch --unsafe
```

### Working with Submodules

**In metapackage**:
```bash
cd extensions/algolia
# Work normally, changes are in submodule
git status  # Shows submodule status
```

**Standalone**:
```bash
git clone git@github.com:diplodoc-platform/algolia-extension.git
cd algolia-extension
# Work independently
```

### Adding/Removing Submodules

1. Update `submodules.conf`:
   ```
   + extensions/new-extension extensions/new-extension git@github.com:diplodoc-platform/new-extension.git
   ```

2. Run check script:
   ```bash
   npm run check-submodules
   ```

3. Apply changes:
   ```bash
   npm run add-submodules
   ```

4. Commit and push

## Reset and Cleanup

### Full Reset

```bash
npm run reset
```

**What it does**:
- Removes all `node_modules` (metapackage and all packages)
- Reinstalls dependencies
- Unlinks `@diplodoc` packages from workspace roots
- Prepares clean state

**Flags**:
- `--quick` / `-q`: Skip node_modules removal
- `--no-metapackage` / `-u`: Don't reinstall metapackage dependencies

### Quick Reset

```bash
npm run reset --quick
# Only unlinks packages, doesn't remove node_modules
```

## Bootstrap Process

The `npm run bootstrap` command sets up the entire development environment:

```bash
npm run bootstrap
```

**Steps**:
1. Initialize git submodules (`git-init.sh`)
2. Apply submodules to master (`git-apply.sh`)
3. Install dependencies (`npm install`)
4. Reset packages (`npm run reset`)
5. Build CLI (`npx nx build @diplodoc/cli`)
6. Reinstall dependencies to link packages

**Use when**:
- First time setup
- After cloning repository
- When submodules are out of sync
- After major dependency changes

## Testing Across Packages

### Testpack

`devops/testpack` provides system tests for the platform:

```bash
cd devops/testpack
npm test
```

**Features**:
- End-to-end tests using Playwright
- Tests integration between packages
- Can be run from metapackage or standalone

### Watch Mode Testing

When running `npm run watch`:
- Changes trigger automatic rebuilds
- Documentation is rebuilt and served
- Integration is tested in real-time

## Common Workflows

### Starting Development

```bash
# First time
npm run bootstrap
npm run watch

# Subsequent times
npm run watch
```

### Working on a Single Package

```bash
cd packages/cli
npm install --no-workspaces
npm run build
npm test
```

### Testing Cross-Package Changes

```bash
# In metapackage root
npm run watch
# Edit packages/cli and packages/transform
# Changes propagate automatically
```

### Updating All Submodules

```bash
npm run git:apply master
```

### Adding a New Dependency

```bash
# To single package
cd packages/cli
npm install new-package

# To multiple packages
npm run deps update new-package@version
```

## Important Notes

1. **Package Independence**: Each package should work standalone
2. **Workspace Linking**: In metapackage mode, packages are linked via workspaces
3. **Submodule Sync**: Submodules are synced hourly, but can be updated manually
4. **Git Workflow**: Uses `--ff-only` merge strategy
5. **Nx Graph**: Always check dependency graph before major changes
6. **Reset Often**: Use `npm run reset` when dependencies get out of sync

