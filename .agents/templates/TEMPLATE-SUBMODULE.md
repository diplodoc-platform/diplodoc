# AGENTS.md Template for Submodules

This is a template for creating `AGENTS.md` in submodules (separate repositories).

## Common Rules and Standards

**Important**: This submodule follows common rules and standards defined in the Diplodoc metapackage. When working in metapackage mode, refer to:

- **`.agents/style-and-testing.md`** in the metapackage root for:
  - Code style guidelines
  - Commit message format (Conventional Commits)
  - Pre-commit hooks rules (**CRITICAL**: Never commit with `--no-verify`)
  - Testing standards
  - Documentation requirements
- **`.agents/core.md`** for core concepts
- **`.agents/monorepo.md`** for workspace and dependency management
- **`.agents/dev-infrastructure.md`** for build and CI/CD

**Note**: In standalone mode (when this submodule is used independently), these rules still apply. If you need to reference the full documentation, check the [Diplodoc metapackage repository](https://github.com/diplodoc-platform/diplodoc).

## Template Structure

```markdown
# AGENTS.md

This file contains instructions for AI agents working with the `[package-name]` project.

## Project Description

[Brief description of what this package/extension/action does]

## Project Structure

### Main Directories

- `src/` — source code of the project
- `build/` or `lib/` or `dist/` — compiled code (generated during build)
- `tests/` or `test/` — project tests
- [Other relevant directories]

## Tech Stack

This package follows the standard Diplodoc platform tech stack. See `.agents/dev-infrastructure.md` and `.agents/style-and-testing.md` in the metapackage root for detailed information.

**Package-specific details**:

- **Language**: [TypeScript/JavaScript/etc.]
- **Runtime**: [Node.js version requirements]
- **Testing**: [Vitest (recommended) / Jest (legacy)]
- **Build**: [Build tool - e.g., esbuild, tsc, rspack]
- **Dependencies**: [Key dependencies]
- **Dev Dependencies**:
  - `@diplodoc/lint` — linting infrastructure
  - `@diplodoc/tsconfig` — TypeScript configuration
  - [Other dev dependencies]

## Setup Commands

```bash
# Install dependencies
npm install

# Build project
npm run build

# Run tests
npm test

# [Other relevant commands]
```

## Dependency Management

**Important**: This package is a submodule that can work both as part of the metapackage (workspace mode) and standalone.

### Installing Dependencies

When adding or updating dependencies in this submodule, you **must** use `--no-workspaces` flag to avoid workspace conflicts:

```bash
# Install new dependency
npm install --no-workspaces package-name@version

# After installation, regenerate package-lock.json for standalone mode
npm install --no-workspaces --package-lock-only
```

**Why `--no-workspaces`?**
- In workspace mode, npm may install dependencies from root or other packages
- This can cause version conflicts (e.g., vitest@3.1.1 in workspace vs vitest@^2.0.0 in package.json)
- Using `--no-workspaces` ensures dependencies are installed locally to this package
- The `--package-lock-only` flag regenerates `package-lock.json` without workspace context, making it valid for standalone mode

**Always use this pattern when**:
- Adding new dependencies
- Updating existing dependencies
- The package needs to work in both metapackage and standalone modes

See `.agents/monorepo.md` in the metapackage root for more details on workspace dependency management.

## Development Commands

```bash
# [List development-specific commands]
```

## Architecture

[Describe key architectural concepts, patterns, and design decisions]

### Key Modules

[Describe main modules and their responsibilities]

## Configuration

[Describe configuration options, if any]

## Testing

**Testing Framework**: [Vitest (recommended) / Jest (legacy)]

**Test Structure**:
- Test files: `*.spec.ts`, `*.test.ts`
- Test location: Next to code or in `tests/` or `test/` directory
- Configuration: `vitest.config.mjs` (for Vitest) or `jest.config.js` (for Jest)

**Running Tests**:
```bash
npm test              # Run tests
npm test:watch        # Watch mode (if configured)
```

**Migration from Jest to Vitest**:
If migrating from Jest, see `.agents/style-and-testing.md` in the metapackage root for detailed migration steps.

[Describe package-specific testing patterns and approaches]

## Code Conventions

1. **File naming**:
   - [Conventions for file naming]

2. **Comments and documentation**:
   - **All code comments must be in English**
   - **All documentation files (ADR, AGENTS.md, README, etc.) must be in English**
   - [Other documentation conventions]

3. **Code style**:
   - [Specific style guidelines]

## Common Tasks

### [Task 1]

[How to perform common task]

### [Task 2]

[How to perform common task]

## Additional Resources

- `README.md` — main documentation
- `CONTRIBUTING.md` — contributor guide (if exists)
- `CHANGELOG.md` — change history

## Important Notes

1. [Important note 1]
2. [Important note 2]
3. [Important note 3]
```

## Usage Instructions

1. Copy this template to the root of a submodule
2. Replace `[package-name]` with the actual package name
3. Fill in all `[placeholders]` with actual information
4. Remove sections that don't apply to the specific project
5. Add project-specific sections as needed
6. Ensure all content is in English

## Sections to Customize

- **Project Description**: Should clearly explain what the package does
- **Project Structure**: Should reflect the actual directory structure
- **Tech Stack**: Should list actual technologies used
- **Architecture**: Should describe key design patterns and concepts
- **Common Tasks**: Should include tasks specific to this package

