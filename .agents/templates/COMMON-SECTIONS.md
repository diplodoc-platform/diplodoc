# Common Documentation Sections

This document defines the standard sections that should be included in AGENTS.md files across the Diplodoc platform.

## Standard Sections

### 1. Project Description
**Purpose**: Brief overview of what the project does

**Content**:
- What the project is
- Main purpose and functionality
- Role in the Diplodoc platform (for workspace packages)

**Example**:
```markdown
## Project Description

`@diplodoc/[package-name]` is a [description]. It provides [main functionality] for the Diplodoc platform.
```

### 2. Project Structure
**Purpose**: Help agents understand the codebase organization

**Content**:
- Main directories and their purposes
- Key files and their roles
- Build output directories

**Example**:
```markdown
## Project Structure

### Main Directories

- `src/` — source code of the project
- `build/` — compiled code (generated during build)
- `tests/` — project tests
```

### 3. Tech Stack
**Purpose**: List technologies and tools used

**Content**:
- Programming language and version
- Runtime requirements
- Testing framework
- Build tools
- Key dependencies

**Example**:
```markdown
## Tech Stack

- **Language**: TypeScript
- **Runtime**: Node.js >= 22
- **Testing**: Vitest
- **Build**: esbuild
```

### 4. Setup Commands
**Purpose**: How to get started with the project

**Content**:
- Installation commands
- Build commands
- Test commands
- Any prerequisites

**Example**:
```markdown
## Setup Commands

```bash
# Install dependencies
npm install

# Build project
npm run build

# Run tests
npm test
```
```

### 5. Development Commands
**Purpose**: Commands for day-to-day development

**Content**:
- Watch mode
- Linting
- Type checking
- Development server (if applicable)

**Example**:
```markdown
## Development Commands

```bash
# Watch mode
npm run watch

# Linting
npm run lint
npm run lint:fix

# Type checking
npm run typecheck
```
```

### 6. Architecture
**Purpose**: Explain design patterns and key concepts

**Content**:
- Key architectural patterns
- Design decisions
- Module organization
- Integration points

**Example**:
```markdown
## Architecture

[Describe key architectural concepts, patterns, and design decisions]

### Key Modules

[Describe main modules and their responsibilities]
```

### 7. Configuration
**Purpose**: Configuration options and how to use them

**Content**:
- Configuration files
- Environment variables
- Command-line options
- Default values

**Example**:
```markdown
## Configuration

The project supports configuration via:
1. Configuration file (`.yfm` or similar)
2. Command-line arguments
3. Environment variables
```

### 8. Testing
**Purpose**: Testing approach and patterns

**Content**:
- Testing framework
- Test structure
- How to write tests
- Coverage requirements

**Example**:
```markdown
## Testing

- **Framework**: Vitest
- **Test files**: `**/*.spec.ts`
- **Coverage**: [requirements]
```

### 9. Code Conventions
**Purpose**: Style and coding standards

**Content**:
- File naming conventions
- Code style rules
- Documentation requirements
- Language requirements (English)

**Example**:
```markdown
## Code Conventions

1. **File naming**:
   - Type files: `types.ts`
   - Configuration: `config.ts`
   - Main module file: `index.ts`

2. **Comments and documentation**:
   - **All code comments must be in English**
   - **All documentation files must be in English**
```

### 10. Common Tasks
**Purpose**: Guide for typical development tasks

**Content**:
- How to add new features
- How to fix bugs
- How to add tests
- How to update dependencies

**Example**:
```markdown
## Common Tasks

### Adding a New Feature

1. Create feature branch
2. Implement feature
3. Add tests
4. Update documentation
```

### 11. Additional Resources
**Purpose**: Links to related documentation

**Content**:
- README.md
- CONTRIBUTING.md
- CHANGELOG.md
- ADR files (if any)
- Related packages

**Example**:
```markdown
## Additional Resources

- `README.md` — main documentation
- `CONTRIBUTING.md` — contributor guide
- `CHANGELOG.md` — change history
```

### 12. Important Notes
**Purpose**: Critical information that agents must know

**Content**:
- Deprecations
- Breaking changes
- Known issues
- Platform-specific notes

**Example**:
```markdown
## Important Notes

1. This package requires Node.js >= 22
2. All changes must pass linter and tests
3. [Other important notes]
```

## Section Priority

### Required Sections
- Project Description
- Setup Commands
- Code Conventions (at minimum, language requirements)

### Recommended Sections
- Project Structure
- Tech Stack
- Development Commands
- Testing
- Common Tasks

### Optional Sections
- Architecture (if complex)
- Configuration (if configurable)
- Additional Resources (if extensive)

## Customization Guidelines

1. **Remove irrelevant sections**: If a section doesn't apply, remove it rather than leaving it empty
2. **Add project-specific sections**: Feel free to add sections unique to the project
3. **Keep it concise**: Documentation should be helpful, not overwhelming
4. **Update regularly**: Keep documentation in sync with code changes

## Language Requirements

**All documentation must be in English**:
- Section headers
- Descriptions
- Code comments in examples
- All text content

This ensures consistency across the platform and makes documentation accessible to all contributors.

