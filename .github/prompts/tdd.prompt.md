---
description: "Guide test-driven development for the Apache Ant Manager extension. RED-GREEN-REFACTOR cycle with parser, path resolution, and task CRUD test patterns."
agent: "agent"
---
Guide TDD for the described feature or bug fix.

## Workflow

1. **Understand the requirement**: Read the feature or bug description
2. **Write a failing test** in `src/test/`:
   - Name it descriptively: `test('should parse targets from build.xml with imports')`
   - Mock the `vscode` module where needed
   - Assert expected behavior, not implementation details
3. **Run the test**: `npm test` — confirm it FAILS (RED)
4. **Implement minimal code** to make the test pass (GREEN)
5. **Run tests again**: Confirm the new test passes AND all existing tests still pass
6. **Refactor**: Clean up while keeping tests green (REFACTOR)
7. **Verify**: Run `npm test` one final time

## Test Patterns for This Project

- **Parser tests**: Create inline XML strings, test `parseWithXml()` output matches expected `AntBuildInfo`
- **Path tests**: Test `toWorkspaceRelativePath()` and `resolveWorkspacePath()` with various workspace configurations
- **Task CRUD tests**: Test `generateTaskConfig()` output format
- **Integration tests**: Use `@vscode/test-electron` for end-to-end flows
