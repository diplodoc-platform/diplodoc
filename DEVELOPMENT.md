# Diplodoc Platform - Development Guide

This is the root repository for Diplodoc Platform development. It contains all packages, extensions, and tools needed for contributing to the platform.

## Prerequisites

- **Node.js >=22**
- **npm >=11.5.1**
- **Git**

## Quick Start

1. **Clone and setup**
   ```bash
   git clone https://github.com/diplodoc-platform/diplodoc.git
   cd diplodoc
   npm run bootstrap
   ```

2. **Start development**
   ```bash
   npm run watch
   ```

That's it! The `bootstrap` command will initialize git submodules, install dependencies, reset packages, and build the CLI.

The `watch` command starts a complete development environment:
- Builds the CLI and all packages
- Starts documentation build process
- Serves documentation on http://localhost:3001
- Watches for file changes and automatically rebuilds
- Restarts documentation when CLI changes are detected

Once running, you can:
- Edit code in `packages/` or `extensions/` directories
- Changes will be automatically detected and rebuilt
- View live documentation at http://localhost:3001/ru/syntax/tabs
- Check the terminal output for build status and any errors
- Start with the main CLI package in `packages/cli/` for core functionality
- Or explore extensions in `extensions/` for specific features

## Main Commands

- **`npm run bootstrap`** - Full project setup (git submodules, dependencies, reset, build CLI)
- **`npm run watch`** - Start complete development environment with hot reloading
- **`npm run build`** - Build testpack
- **`npm run test`** - Run testpack tests
- **`npm run reset`** - Clean and reset everything
- **`npm run deps`** - Install dependencies only

## Project Structure

This is a monorepo with the following structure:

- **`packages/`** - Core Diplodoc packages
- **`extensions/`** - Platform extensions (algolia, cut, mermaid, page-constructor, etc.)
- **`devops/`** - DevOps tools and configurations (including testpack for development)
- **`scripts/`** - Build and development scripts
- **`docs/`** - Documentation source files

## Additional Commands

### Git Submodules Management
```bash
npm run check-submodules    # Check submodules status
npm run add-submodules      # Add/remove submodules
npm run git:init           # Initialize git configuration
npm run git:apply          # Apply git changes
npm run git:head           # Apply git changes from master (unsafe)
```

### Development Tools
```bash
npm run analyze-deps       # Check Node.js version compatibility
npm run codespaces        # Setup for GitHub Codespaces
```

### Working with Individual Packages

Use nx to work with specific packages:
```bash
npx nx build @diplodoc/cli     # Build specific package
npx nx test <package-name>     # Run tests
npx nx lint <package-name>     # Lint code
```

## Development Workflow

1. **Setup**: Run `npm run bootstrap` once to initialize everything
2. **Development**: Run `npm run watch` to start development mode
3. **Code**: Make changes to packages or extensions
4. **Test**: Changes are automatically rebuilt and served at localhost:3001
5. **Debug**: Check terminal output for any build errors

The watch command handles the complete development cycle, so you don't need to manually restart services when making changes.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test your changes using `npm run watch`
5. Submit a pull request

For detailed contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Useful Links

- [Website](https://diplodoc.com)
- [Documentation (Russian)](https://diplodoc.com/docs/ru/)
- [Documentation (English)](https://diplodoc.com/docs/en/)
- [Telegram Community](https://t.me/diplodoc_ru)
- [Issues](https://github.com/diplodoc-platform/diplodoc/issues)

## Workspace Configuration

This repository uses workspaces with the following patterns:
- `devops/*`
- `extensions/*`
- `extensions/**/example`
- `packages/*`

Each workspace can be developed independently while sharing common dependencies and build tools.
