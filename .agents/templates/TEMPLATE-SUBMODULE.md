# AGENTS.md Template for Submodules

This is a template for creating `AGENTS.md` in submodules (separate repositories).

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

- **Language**: [TypeScript/JavaScript/etc.]
- **Runtime**: [Node.js version requirements]
- **Testing**: [Testing framework]
- **Build**: [Build tool]

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

