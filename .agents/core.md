# Agent Guide – Core Concepts

## Platform Overview

Diplodoc Platform is an open platform for working with documentation in accordance with "Documentation as a Code" paradigm. It provides tools for building documentation from Markdown files with Yandex Flavored Markdown (YFM) support.

**Key Features**:
- Enhanced Markdown with documentation components (code blocks, images, diagrams, etc.)
- Integration with OpenAPI for auto-generated documentation
- Native translation support
- Single source publishing
- Page Constructor integration
- Right-to-Left (RTL) mode support
- Integrated search functionality

## Metapackage vs Monorepo

**Important**: This is a **metapackage**, not a monorepo. The key difference:

- **Monorepo**: Strives to organize a common infrastructure that all packages depend on
- **Metapackage**: Adds additional infrastructure for collaborative development of multiple packages, but each package is a **standalone unit** that can be cloned separately and developed without knowing it's part of the metapackage

**Implications**:
- Each package can be developed independently
- Packages should not depend on metapackage-specific infrastructure
- Packages can be cloned and built separately
- Workspace configuration is optional for package development

## Project Structure

### Main Directories

- **`packages/`** – Core Diplodoc packages (all are submodules)
  - Critical packages: `cli`, `transform`, `components`
  - Infrastructure packages: `utils`, `directive`, `sentenizer`, `translation`, `yfmlint`
  - Other packages: `client`, `gh-docs`, `liquid`
  - **All packages are separate Git repositories**
  
- **`extensions/`** – Platform extensions (all are submodules)
  - All extensions are separate Git repositories
  - Extensions: `algolia`, `color`, `cut`, `file`, `folding-headings`, `html`, `latex`, `mermaid`, `openapi`, `page-constructor`, `quote-link`, `search`, `tabs`
  - Each extension is independent
  
- **`devops/`** – DevOps tools and configurations (all are submodules)
  - Infrastructure packages that integrate across the metapackage
  - All devops packages are separate Git repositories
  - Packages: `babel-preset`, `lint`, `package-template`, `testpack`, `tsconfig`
  - **Notes**:
    - `eslint-config` and `prettier-config` are deprecated; all functionality is now in `lint`
    - `package-template` is currently outdated and needs to be updated (see `.agents/TODO.md`)
  
- **`actions/`** – GitHub Actions (all are submodules)
  - All actions are separate Git repositories
  - Actions: `docs-build`, `docs-build-static`, `docs-clean`, `docs-message`, `docs-release`, `docs-upload`
  
- **`scripts/`** – Build and development scripts
  - `bootstrap.sh` – initial setup
  - `watch.js` – development watch mode
  - `reset.js` – clean and reset
  - `deps.js` – dependency management
  - `nx.js` – Nx utilities
  
- **`docs/`** – User documentation (special submodule)
  - **Note**: This is a special submodule that stores user-facing documentation
  - It is **not** an npm package
  - It does not follow the standard package structure

## Package Hierarchy

### Critical Packages

These packages are the foundation of the Diplodoc ecosystem and are used by external systems:

1. **`@diplodoc/cli`** – CLI tool for building documentation
2. **`@diplodoc/transform`** – Markdown to HTML transformer
3. **`@diplodoc/components`** – UI components library

### Package Dependencies

**Extension Dependencies**:
- Each extension is independent and does not depend on other extensions
- Extensions can depend on infrastructure packages: `@diplodoc/directive`, `@diplodoc/utils`
- Extensions are integrated into `transform` or `cli` as dependencies
- Extensions connected directly to `transform` are more important than those connected to `cli`

**Package Dependencies**:
- **Devops packages**: Infrastructure packages that integrate across the metapackage
  - `@diplodoc/lint` – Linting utilities (used by all packages)
    - Includes ESLint, Prettier, and Stylelint configurations
    - Replaces deprecated `@diplodoc/eslint-config` and `@diplodoc/prettier-config`
  - `@diplodoc/tsconfig` – TypeScript configurations (used by all packages)
  - `@diplodoc/babel-preset` – Babel presets
- **Core packages**: Core ecosystem packages
  - Critical packages (`cli`, `transform`, `components`) are used by external systems
  - Other packages (`utils`, `directive`, `sentenizer`, `translation`, `yfmlint`) are used internally

**Dependency Rules**:
- **Extensions cannot depend on each other** (unwritten rule)
- Extensions can depend on infrastructure packages (`directive`, `utils`)
- Extensions are integrated into core packages (`transform`, `cli`)
- Core packages can depend on extensions and infrastructure packages
- Infrastructure packages should not depend on core packages or extensions
- **No circular dependencies** (Nx doesn't handle them well)
- Submodules are independent as submodules, but can depend on each other through npm packages (build artifacts)

**Peer Dependencies**:
- Used when a package should not be tied to a specific version of a library
- The library is expected to be higher in the dependency graph
- The package remains compatible with the library version provided by the parent

**Versioning**:
- Each package has its own versioning system
- No synchronized version bumps across packages
- Versions are managed independently per package

**Example Dependency Flow**:
```
@diplodoc/cli
  ├── @diplodoc/transform (core)
  │     ├── @diplodoc/cut-extension
  │     ├── @diplodoc/file-extension
  │     └── @diplodoc/tabs-extension
  ├── @diplodoc/client
  └── @diplodoc/components

@diplodoc/cut-extension
  ├── @diplodoc/directive (infrastructure)
  └── @diplodoc/utils (infrastructure)
```

## Workspace Configuration

The metapackage uses npm workspaces to link all submodules together for development:

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

**Key Point**: Even though all packages are submodules (separate Git repositories), npm workspaces allow them to be linked together in the metapackage for:
- Shared `node_modules` at the root
- Automatic linking of `@diplodoc/*` packages
- Coordinated development across packages
- Shared build tools and configurations

Each submodule can still be cloned and developed independently, but the metapackage provides a convenient way to work with all packages together.

## Submodules

### What are Submodules?

Submodules are separate Git repositories that are included in the metapackage. They allow packages to be developed independently while still being part of the metapackage for collaborative development.

### Submodule Structure

**Important**: **ALL packages, extensions, and devops tools are submodules** (separate Git repositories). The metapackage uses npm workspaces to link them together for development, but each can be cloned and developed independently.

**Submodule Categories**:
- **Extensions** (`extensions/*`) – Platform extensions
- **Packages** (`packages/*`) – Core Diplodoc packages
- **Devops** (`devops/*`) – DevOps tools and configurations
- **Actions** (`actions/*`) – GitHub Actions

**Special Submodule**:
- `docs/` – User documentation (submodule, **not an npm package**)
  - This is a special case: it's a submodule but not part of the npm workspace
  - Contains user-facing documentation source files
  - Does not follow standard package structure

**Finding Submodules**:
- Full list of submodules: see `.gitmodules` in the metapackage root
- To check current submodules: `cat .gitmodules | grep -E "^\[submodule"`
- Submodules are managed via `submodules.conf` and `npm run add-submodules`

### Submodule Management

- **Synchronization**: GitHub workflow runs hourly to update master branches of submodules within the metapackage
- **Updates**: Submodules should be updated as frequently as possible
- **Independence**: As submodules, they are independent, but can depend on each other through npm packages (build artifacts)

### Submodule Commands

```bash
npm run check-submodules    # Check submodules status
npm run add-submodules      # Add/remove submodules according to submodules.conf
npm run git:init           # Initialize git configuration
npm run git:apply          # Apply git changes (default: master)
npm run git:head           # Apply git changes from master (unsafe)
```

## Nx Integration

Nx is used for:
- **Dependency graph**: Understanding package dependencies
- **Build orchestration**: Coordinating builds across packages
- **Script utilities**: Several scripts in `scripts/` directory use Nx graph

Nx configuration is in `nx.json` and defines:
- Build targets and caching
- Dependency relationships
- Input/output patterns

## Key Concepts

### YFM (Yandex Flavored Markdown)

YFM is an enhanced Markdown format that extends standard Markdown with:
- Documentation-specific features
- Code blocks with syntax highlighting
- Images and diagrams
- Internal links and navigation
- Template variables
- Includes and snippets

### Extensions

Extensions add functionality to the Diplodoc platform and have a dual structure:

**Plugin Part** (`src/plugin/`):
- Markdown-it plugins that transform Markdown during build
- Process Markdown tokens and generate HTML
- Export as `build/plugin/index.js`
- Used by `@diplodoc/transform` during Markdown processing

**Runtime Part** (`src/runtime/`):
- JavaScript code that runs in the browser
- Adds interactive features to rendered documentation
- Export as `build/runtime/index.js` and `build/runtime/index.css`
- Loaded by the documentation client

**Extension Structure**:
```
extension-name/
├── src/
│   ├── plugin/          # Markdown-it plugin
│   └── runtime/         # Browser runtime code
├── build/
│   ├── plugin/          # Compiled plugin
│   └── runtime/         # Compiled runtime
└── package.json         # Exports both plugin and runtime
```

**Package Exports**:
```json
{
  "exports": {
    ".": "./build/plugin/index.js",           // Plugin entry
    "./runtime": "./build/runtime/index.js",   // Runtime entry
    "./runtime/styles": "./build/runtime/index.css"
  }
}
```

**Extension Dependencies**:
- Extensions can depend on `@diplodoc/directive`, `@diplodoc/utils`
- Extensions are independent of each other (cannot depend on each other)
- Extensions are integrated into `@diplodoc/transform` or `@diplodoc/cli`

**Extension Integration**:

**In Transform**:
- Extensions are connected as plugins (from `src/plugin/` directory)
- Plugins are passed via `options.plugins` in `transform(content, options)`
- See `packages/cli/src/core/program/index.ts#L261` for CLI integration details

**In CLI**:
- Extensions can be enabled via `--extension` or `-e` argument (e.g., `-e algolia`)
- CLI checks various prefixes and finds the package (e.g., `@diplodoc/algolia-extension`)
- Extensions can also be configured via `.yfm` config file
- Some extensions are auto-initialized (see ADR-001: Dependent Extensions)

**Documentation**:
- Basic extension architecture: see `docs/ru/dev`
- More detailed documentation for developers/agents is needed (separate interview recommended)

**Examples**:
- `@diplodoc/cut-extension`: Adds collapsible sections
- `@diplodoc/tabs-extension`: Adds tabbed content
- `@diplodoc/mermaid-extension`: Renders Mermaid diagrams

### CLI Commands

The main CLI tool (`@diplodoc/cli`) provides commands:
- `build` – Build documentation from Markdown
  - Processes YFM files
  - Applies extensions
  - Generates HTML output
- `publish` – Publish documentation
  - Uploads built documentation
  - Manages versions
- `translate` – Extract and manage translations
  - Extracts translatable strings
  - Manages translation files

**CLI Error Handling**:
- CLI catches errors, logs them, and tries to continue work
- This allows logging as many problems as possible in a single run
- If any errors were logged, CLI exits with non-zero code
- This pattern is being adopted across the platform (work in progress)

### Transform Package

`@diplodoc/transform` is the core transformation engine:
- Converts YFM Markdown to HTML
- Uses markdown-it as the base parser
- Integrates extension plugins
- Processes includes, snippets, and templates
- Handles sanitization and security

**Key Dependencies**:
- `markdown-it` – Markdown parser
- Extension plugins (cut, file, tabs, etc.)
- `@diplodoc/utils` – Utility functions
- `cheerio` – HTML manipulation

## Development Philosophy

1. **Standalone packages**: Each package should work independently
2. **Metapackage benefits**: Shared infrastructure for development, but not required for package usage
3. **Clear boundaries**: Packages should not depend on metapackage-specific infrastructure
4. **Independent development**: Developers should be able to work on a single package without the full metapackage

