# Agent Guide – Style, Testing, and Documentation

## Code Style

### Language Requirements

- **All code comments must be in English**
- **All documentation files (ADR, AGENTS.md, README, etc.) must be in English**
- **All commit messages must be in English**

### TypeScript Standards

- TypeScript strict mode (where applicable)
- ES modules
- Prefer functional patterns where possible
- Explicit types over `any`
- Use `unknown` with type narrowing instead of `any`

### Code Organization

- Small, focused functions
- Early returns
- Descriptive variable names (avoid single-letter names except trivial indices)
- Pure functions where possible
- Composition over inheritance

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <subject>

<body>
```

### Commit Types

- **`feat`**: New feature for end users
- **`fix`**: Bug fix for end users
- **`perf`**: Performance improvement
- **`refactor`**: Code refactoring that doesn't change functionality
- **`docs`**: Documentation changes only
- **`chore`**: Maintenance tasks and infrastructure changes
- **`revert`**: Reverting a previous commit

### Examples

```
feat(cli): add support for custom output formats
fix(transform): handle edge case in markdown parsing
refactor(components): extract common button logic
docs(readme): update installation instructions
chore(deps): update lodash to 4.17.21
```

### Release Management

The project uses **release-please** for automated version management:
- Versions are managed automatically based on commit types
- `feat` commits trigger minor version bumps
- `fix` commits trigger patch version bumps
- Breaking changes trigger major version bumps

## Import Organization

Imports should be organized in a specific order:

1. **Type imports first** (all `import type` statements):
   - External type imports
   - Internal type imports

2. **External runtime imports** (from `node_modules`):
   - Standard library imports
   - Third-party package imports

3. **Internal imports** (from workspace packages):
   - `@diplodoc/*` package imports
   - Relative imports

4. **Side-effect imports** (if any):
   - CSS imports
   - Polyfills

**Example**:
```typescript
import type {Config} from '@diplodoc/cli';
import type {TransformOptions} from './types';

import {readFile} from 'node:fs';
import {join} from 'path';
import lodash from 'lodash';

import {transform} from '@diplodoc/transform';
import {logger} from '@diplodoc/utils';

import {processMarkdown} from './process';
import './styles.css';
```

## Linting and Formatting

### Linting Tool

The platform uses `@diplodoc/lint` for linting:

```bash
# Initialize linting in a package
npx @diplodoc/lint init

# Run linting
npm run lint

# Fix linting issues
npm run lint:fix
```

### Lint Configuration

`@diplodoc/lint` provides:
- ESLint configurations (common, client, node)
- Prettier configuration
- Stylelint configuration
- Husky hooks
- Lint-staged configuration

### Exports

The lint package exports configurations:
- `@diplodoc/lint/eslint-config` – Common ESLint config
- `@diplodoc/lint/eslint-config/client` – Client-side ESLint config
- `@diplodoc/lint/eslint-config/node` – Node.js ESLint config
- `@diplodoc/lint/prettier-config` – Prettier config
- `@diplodoc/lint/stylelint-config` – Stylelint config

**Note**: These are exports from the `@diplodoc/lint` package, not separate packages. The deprecated `@diplodoc/eslint-config` and `@diplodoc/prettier-config` packages have been merged into `@diplodoc/lint`.

### Pre-commit Hooks

Husky is configured to run linting before commits:
- Runs `lint-staged` on staged files
- Prevents commits with linting errors
- Auto-fixes issues when possible

**CRITICAL RULE**: Pre-commit checks must pass without additional flags. **Never commit with `--no-verify`**. If pre-commit hooks fail, fix the issues first, then commit. The pre-commit hook ensures code quality and should never be bypassed.

## Testing

### Testing Philosophy

- **Unit tests**: Test individual functions and modules
- **Integration tests**: Test package interactions
- **System tests**: Test full platform functionality (via testpack)

### Testing Framework Recommendation

**Use Vitest** for all new packages and tests. Vitest is the recommended testing framework for the Diplodoc platform:
- Faster execution
- Better TypeScript support
- ESM-first design
- Compatible with Jest API (easier migration)

Existing packages using Jest should be migrated to Vitest when possible.

### Test Frameworks

Different packages may use different frameworks:
- **Vitest**: Recommended testing framework (preferred for new packages and migrations)
- **Jest**: Legacy testing framework (some older packages still use it, but migration to Vitest is recommended)
- **Playwright**: End-to-end testing (used in testpack)

**Recommendation**: Use Vitest for all new packages and consider migrating existing Jest-based tests to Vitest.

### Test Structure

- Test files: `*.spec.ts`, `*.test.ts`
- Test location: Next to code or in `__tests__/` or `test/` directory
- Arrange-Act-Assert pattern
- Extract repeated setup into helper functions

### Testpack

`devops/testpack` provides system-level testing:

```bash
cd devops/testpack
npm test
```

**Purpose**:
- End-to-end tests for the platform
- Integration testing between packages
- Regression testing

**Usage**:
- Run from testpack directory
- Can be run from metapackage root
- Uses Playwright for browser testing

### Testing in Watch Mode

When running `npm run watch`:
- Changes trigger automatic rebuilds
- Documentation is rebuilt
- Integration is tested in real-time via served documentation

## Documentation Standards

### JSDoc Comments

**Goal**: Strive for comprehensive JSDoc documentation (currently being improved)

**Guidelines**:
- Document all exported functions and classes
- Use `@param` for parameters
- Use `@returns` for return values
- Use `@throws` for exceptions
- Use `@example` for usage examples

**Example**:
```typescript
/**
 * Transforms Markdown content to HTML.
 *
 * @param content - Markdown content to transform
 * @param options - Transformation options
 * @returns Transformed HTML content
 * @throws {Error} If content is invalid
 *
 * @example
 * ```typescript
 * const html = transform('# Hello', {});
 * ```
 */
export function transform(content: string, options: TransformOptions): string {
  // ...
}
```

### README Files

Each package should have a `README.md` with:
- Package description
- Installation instructions
- Usage examples
- API documentation (or link to it)
- Contributing guidelines (if applicable)

### ADR (Architecture Decision Records)

ADR files should be stored in each submodule:
- Location: `docs/ADR/` directory at the submodule level
- Format: Markdown files
- Naming: `ADR-XXX-short-description.md`

**Example locations**:
- `packages/cli/docs/ADR/ADR-001-dependent-extensions.md`
- `extensions/openapi/docs/ADR/ADR-002-openapi-processing-pipeline.md`

### AGENTS.md Files

AGENTS.md files provide guidance for AI agents:
- Should be in English
- Should follow templates in `docs/AGENTS/templates/`
- Should be comprehensive but concise
- Should be updated when project structure changes

## File Naming Conventions

- **Type files**: `types.ts`
- **Configuration**: `config.ts`
- **Main module**: `index.ts`
- **Tests**: `*.spec.ts` or `*.test.ts`
- **Build configs**: `tsconfig.json`, `esbuild/*`, `rspack/*`

## Code Comments

### When to Comment

- **Why, not what**: Explain reasoning, not obvious code
- **Complex logic**: Document non-obvious algorithms
- **Workarounds**: Explain temporary solutions or known issues
- **API decisions**: Document why an API was designed a certain way

### Comment Style

- Use English for all comments
- Prefer JSDoc for exported APIs
- Use inline comments sparingly
- Keep comments up-to-date with code

## Git Workflow

### Branch Strategy

- Uses `--ff-only` merge strategy
- Prefer fast-forward merges
- Keep history linear when possible

### Branch Naming

- Feature branches: `feature/description`
- Bug fixes: `fix/description`
- Hotfixes: `hotfix/description`

### Pull Requests

- Should follow conventional commits format
- Should pass all linting and tests
- Should update documentation if needed
- Should be reviewed before merging

## Common Patterns

### Error Handling

- Use explicit error types
- Provide meaningful error messages
- Handle errors at appropriate levels
- Don't swallow errors silently

### Async Code

- Prefer `async/await` over promises
- Handle errors in async functions
- Use proper error propagation

### Type Safety

- Avoid `any` type
- Use `unknown` with type narrowing
- Prefer explicit types
- Use type guards when needed

## Important Notes

1. **English Only**: All code, comments, and documentation must be in English
2. **Conventional Commits**: Always use conventional commit format
3. **Linting**: All code must pass linting before commit
4. **Pre-commit Hooks**: Pre-commit checks must pass without additional flags. **Never commit with `--no-verify`**. If pre-commit hooks fail, fix the issues first, then commit.
5. **Testing**: Add tests for new features and bug fixes
6. **Documentation**: Update documentation when behavior changes
7. **JSDoc**: Strive for comprehensive JSDoc (currently being improved)

