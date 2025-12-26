# TODO: Infrastructure Improvements

This file tracks infrastructure improvements and maintenance tasks identified during documentation.

## High Priority

### 1. Update `package-template`
- **Status**: Outdated
- **Issue**: Does not use `@diplodoc/lint`
- **Reference**: See `extensions/search-extension` for current infrastructure setup
- **Action**: Update `devops/package-template` to reflect current best practices

### 2. Validate/Fix `deps.js` Script
- **Status**: May not work correctly
- **Issue**: Script is rarely used and may have bugs
- **Action**: Test and fix `scripts/deps.js` or document its limitations

## Medium Priority

### 3. Add Nx Plugins
- **Status**: No plugins currently configured
- **Issue**: Missing potential benefits from Nx ecosystem
- **Action**: Research and add useful Nx plugins for better development experience

### 4. Extension Development Documentation
- **Status**: Basic docs exist, detailed docs needed
- **Issue**: Need comprehensive guide for creating extensions
- **Reference**: Start with `docs/ru/dev`, then create detailed agent documentation
- **Action**: Create separate interview/documentation session for extension development

### 5. Critical Package Documentation
- **Status**: Need detailed documentation
- **Packages**: `cli`, `transform`, `components`
- **Action**: Conduct separate interviews for each critical package

## Low Priority

### 6. Improve Public API Documentation
- **Status**: Manual, inconsistent
- **Issue**: Public APIs documented when developers remember
- **Action**: Improve and automate API documentation

### 7. Testing Strategy Documentation
- **Status**: No clear strategy documented
- **Issue**: Testing approach varies across packages
- **Action**: Document testing strategy and best practices

### 8. Error Handling Patterns
- **Status**: Partial implementation
- **Issue**: CLI has error handling pattern, but not fully documented
- **Current**: CLI logs errors and continues work, exits with non-zero code if errors occurred
- **Action**: Document error handling patterns across the platform

## Notes

- These tasks were identified during the agent documentation creation process
- Priority levels are suggestions and may change based on project needs
- Some tasks may require separate interviews or deep dives into specific packages

