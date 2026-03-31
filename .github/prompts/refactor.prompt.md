---
description: "Refactor code safely while preserving existing behavior and architecture patterns. Covers pattern preservation, validation steps, and common refactoring targets."
agent: "agent"
---
Refactor the specified code while preserving existing behavior and architecture patterns.

## Rules

1. **No behavior changes**: Refactoring must not change what the code does, only how it's organized
2. **Preserve patterns**: Maintain the project's established patterns:
   - Singleton panels with `createOrShow()`
   - Service DI from `extension.ts`
   - Webview message passing protocol
   - Path resolution via `toWorkspaceRelativePath()` / `resolveWorkspacePath()`
3. **Run tests**: `npm test` before AND after refactoring
4. **Run lint**: `npm run lint` after refactoring
5. **Run build**: `npm run compile` to verify webpack bundles correctly

## Common Refactoring Targets

- Extract helper methods from long panel `_getHtmlForWebview()` methods
- Extract message type interfaces for type-safe webview communication
- Split large service methods into smaller focused functions
- Extract shared utilities from panels or services
- Consolidate duplicate error handling patterns

## Do NOT

- Move services into panels
- Break the singleton panel pattern
- Change the webview message protocol without updating both sides
- Refactor Java and TypeScript types independently (must stay in sync)
