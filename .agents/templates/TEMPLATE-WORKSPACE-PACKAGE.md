# AGENTS.md Template for Submodules

**Note**: In the Diplodoc metapackage, all packages are submodules (separate Git repositories). This template is for creating `AGENTS.md` in submodule packages.

## Template Structure

```markdown
# AGENTS.md

This file contains instructions for AI agents working with the `[package-name]` workspace package.

## Project Description

[Brief description of what this package does and its role in the Diplodoc platform]

## Project Structure

### Main Directories

- `src/` — source code of the project
- `build/` or `lib/` or `dist/` — compiled code (generated during build)
- `tests/` or `test/` — project tests
- [Other relevant directories]

## Tech Stack

- **Language**: [TypeScript/JavaScript/etc.]
- **Runtime**: [Node.js version requirements]
- **Testing**: [Testing framework]
- **Build**: [Build tool]

## Setup Commands

```bash
# Install dependencies (from monorepo root)
npm install

# Build project
npm run build
# or from monorepo root:
npx nx build @diplodoc/[package-name]

# Run tests
npm test
# or from monorepo root:
npx nx test @diplodoc/[package-name]
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
# Note: Can be run from package directory or monorepo root using nx
```

## Architecture

[Describe key architectural concepts, patterns, and design decisions]

### Key Modules

[Describe main modules and their responsibilities]

### Integration with Other Packages

[Describe how this package integrates with other Diplodoc packages]

## Configuration

[Describe configuration options, if any]

## Testing

[Describe testing approach and patterns]

## Code Conventions

1. **File naming**:
   - [Conventions for file naming]

2. **Comments and documentation**:
   - **All code comments must be in English**
   - **All documentation files (ADR, AGENTS.md, README, etc.) must be in English**
   - [Other documentation conventions]

3. **Code style**:
   - [Specific style guidelines]

## Working with Metapackage

- This package is a submodule in the Diplodoc metapackage
- It is a separate Git repository that can be cloned independently
- In the metapackage, it is linked via npm workspaces
- Dependencies on other Diplodoc packages should use workspace protocol or package names
- Build and test commands can be run from package directory or metapackage root using nx
- Changes to this package may affect other packages in the metapackage

## Common Tasks

### [Task 1]

[How to perform common task]

### [Task 2]

[How to perform common task]

## Additional Resources

- `README.md` — main documentation
- `CONTRIBUTING.md` — contributor guide (if exists)
- `CHANGELOG.md` — change history
- Root `docs/AGENTS/` — platform-wide agent documentation

## Important Notes

1. This is a submodule (separate Git repository) in the Diplodoc metapackage
2. It can be cloned and developed independently
3. In the metapackage, it is linked via npm workspaces for collaborative development
4. [Important note 4]
```

## Usage Instructions

1. Copy this template to the root of a workspace package
2. Replace `[package-name]` with the actual package name
3. Fill in all `[placeholders]` with actual information
4. Remove sections that don't apply to the specific project
5. Add project-specific sections as needed
6. Ensure all content is in English
7. Note that workspace packages are part of the monorepo, not separate repositories

## Sections to Customize

- **Project Description**: Should clearly explain what the package does and its role
- **Project Structure**: Should reflect the actual directory structure
- **Tech Stack**: Should list actual technologies used
- **Architecture**: Should describe key design patterns and concepts
- **Integration with Other Packages**: Should describe dependencies and relationships
- **Common Tasks**: Should include tasks specific to this package

