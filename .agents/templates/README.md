# AGENTS Documentation Templates

This directory contains templates for creating `AGENTS.md` files for different types of projects in the Diplodoc platform.

## Available Templates

### 1. `TEMPLATE-METAPACKAGE.md`
Template for the root metapackage documentation.

**Use for**: Root `/diplodoc/AGENTS.md`

**Key features**:
- Index-style structure pointing to detailed docs in `docs/AGENTS/`
- References to core, monorepo, style, and infrastructure docs

### 2. `TEMPLATE-SUBMODULE.md`
Template for submodules (separate repositories).

**Use for**: 
- `extensions/algolia/AGENTS.md`
- `extensions/color/AGENTS.md`
- `extensions/quote-link/AGENTS.md`
- `actions/docs-build/AGENTS.md`
- `actions/docs-build-static/AGENTS.md`
- `actions/docs-clean/AGENTS.md`
- `actions/docs-message/AGENTS.md`
- `actions/docs-release/AGENTS.md`
- `actions/docs-upload/AGENTS.md`
- `packages/liquid/AGENTS.md`
- `packages/yfmlint/AGENTS.md`

**Key features**:
- Standalone documentation (submodules are separate repos)
- Project-specific structure and conventions
- Setup and development commands

### 3. `TEMPLATE-WORKSPACE-PACKAGE.md`
Template for submodule packages (all packages in the metapackage are submodules).

**Use for**:
- `packages/cli/AGENTS.md` (already exists, can be used as reference)
- `packages/transform/AGENTS.md`
- `packages/components/AGENTS.md`
- `extensions/cut/AGENTS.md`
- `extensions/file/AGENTS.md`
- All other packages (all are submodules)

**Key features**:
- Metapackage-aware documentation
- References to nx commands
- Integration with other packages
- Standalone development capability

## Usage Guidelines

1. **Choose the right template** based on project type:
   - Metapackage root → `TEMPLATE-METAPACKAGE.md`
   - Submodule (all packages are submodules) → `TEMPLATE-SUBMODULE.md` or `TEMPLATE-WORKSPACE-PACKAGE.md`
   - Note: In Diplodoc, all packages are submodules, so `TEMPLATE-SUBMODULE.md` and `TEMPLATE-WORKSPACE-PACKAGE.md` are essentially the same

2. **Customize the template**:
   - Replace all `[placeholders]` with actual information
   - Remove sections that don't apply
   - Add project-specific sections as needed

3. **Follow conventions**:
   - All documentation must be in English
   - Use consistent structure across similar projects
   - Reference existing good examples (e.g., `packages/cli/AGENTS.md`)

4. **Validate**:
   - Ensure all sections are filled
   - Check that commands work
   - Verify links and references

## Examples

Good examples of existing documentation:
- `packages/cli/AGENTS.md` - comprehensive workspace package documentation
- `extensions/openapi/AGENTS.md` - good submodule-style documentation

## Common Sections

All templates should include (when applicable):

- **Project Description**: What the project does
- **Project Structure**: Directory layout
- **Tech Stack**: Technologies used
- **Setup Commands**: How to get started
- **Development Commands**: Development workflow
- **Architecture**: Key design patterns
- **Testing**: Testing approach
- **Code Conventions**: Style guidelines
- **Common Tasks**: Typical development tasks
- **Additional Resources**: Links to other docs

## Notes

- Templates are starting points - customize as needed
- Some projects may need additional sections
- Keep documentation concise but complete
- Update documentation when project structure changes

