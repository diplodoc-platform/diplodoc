# Metapackage Analysis

This document contains analysis of the Diplodoc metapackage structure based on code inspection and documentation review.

## Discovered Patterns

### 1. Extension Architecture

**Dual Structure**:
- **Plugin** (`src/plugin/`): Markdown-it plugins that process Markdown during build
- **Runtime** (`src/runtime/`): Browser JavaScript that adds interactivity

**Integration Points**:
- Extensions are integrated into `@diplodoc/transform` as dependencies
- Transform uses markdown-it and loads extension plugins
- Runtime code is bundled and loaded by the documentation client

**Example**: `@diplodoc/cut-extension`
- Plugin: Processes `{% cut %}` directives in Markdown
- Runtime: Adds expand/collapse functionality in browser

### 2. Package Dependency Hierarchy

**Infrastructure Layer** (devops packages):
- `@diplodoc/lint` – Used by all packages for linting
  - Includes ESLint, Prettier, and Stylelint configurations
  - Replaces deprecated `@diplodoc/eslint-config` and `@diplodoc/prettier-config`
- `@diplodoc/tsconfig` – Used by all packages for TypeScript config
- `@diplodoc/babel-preset` – Build tooling

**Core Layer** (packages):
- `@diplodoc/cli` – Main CLI tool
- `@diplodoc/transform` – Markdown transformer
- `@diplodoc/components` – UI components
- `@diplodoc/client` – Client-side code
- `@diplodoc/utils` – Utility functions
- `@diplodoc/directive` – Directive processing

**Extension Layer** (extensions):
- Independent extensions
- Can depend on infrastructure packages
- Integrated into core packages

### 3. Build Artifacts Pattern

**Observation**: Dependencies work through "build artifacts"

**Meaning**:
- Packages must be built before being used as dependencies
- In watch mode, packages are rebuilt automatically
- Workspace linking allows using local builds instead of published versions
- "Unlink non-local" means removing published versions to use local builds

### 4. Workspace Linking

**In Metapackage Mode**:
- All `@diplodoc/*` packages are linked in root `node_modules`
- Changes in one package are immediately available to others
- No need to publish packages for local development

**In Standalone Mode**:
- Packages use published versions from npm
- Must publish changes to use them in other packages

### 5. Extension Integration

**Transform Integration**:
- `@diplodoc/transform` directly depends on extensions:
  - `@diplodoc/cut-extension`
  - `@diplodoc/file-extension`
  - `@diplodoc/tabs-extension`
- Extensions are loaded as markdown-it plugins
- Runtime code is bundled separately

**CLI Integration**:
- CLI uses transform for building
- CLI may have its own extension loading mechanism
- Some extensions are auto-initialized by CLI

### 6. TypeScript Configuration

**Pattern**:
- Base configs in `devops/tsconfig`
- Packages extend base configs
- Different configs for different build targets:
  - `tsconfig.json` – Main config
  - `tsconfig.transform.json` – Transform-specific
  - `tsconfig.publish.json` – Publishing config
  - `tsconfig.types.json` – Type definitions only

### 7. Build Systems

**Variety of Build Tools**:
- **TypeScript**: `tsc` for type checking and compilation
- **esbuild**: Fast bundling for some packages
- **rspack**: Web bundling for client packages
- **Custom scripts**: Package-specific build processes

**Build Outputs**:
- `build/` – Common output directory
- `lib/` – Library output
- `dist/` – Distribution files

### 8. Testing Infrastructure

**Layers**:
- **Unit tests**: Package-level (Vitest recommended, Jest legacy)
- **Integration tests**: Cross-package (testpack)
- **E2E tests**: Full platform (Playwright in testpack)

**Testpack**:
- System-level testing
- Tests integration between packages
- Uses Playwright for browser testing
- Can be run from metapackage or standalone

## Questions for Clarification

See `.agents/QUESTIONS.md` for detailed questions that need answers to complete the documentation.

## Areas Needing Expansion

1. **Extension Development Guide**: How to create a new extension
2. **Plugin System**: How markdown-it plugins are registered and used
3. **Runtime Integration**: How runtime code is loaded in the browser
4. **Build Process Details**: Step-by-step build process
5. **Dependency Resolution**: How dependencies are resolved in different modes
6. **Version Management**: How versions are managed across packages

## Known Issues

1. **`package-template` is outdated**: The `devops/package-template` package does not contain the current infrastructure setup for creating new packages. It needs to be updated to reflect the current best practices and tooling.

## Next Steps

1. Answer questions in `.agents/QUESTIONS.md`
2. Expand documentation based on answers
3. Add extension development guide
4. Add plugin system documentation
5. Add build process details

