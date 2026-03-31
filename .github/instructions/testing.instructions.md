---
description: "Use when writing or modifying tests. Covers VS Code test runner patterns, parser testing, path resolution testing, test structure, and what to test vs what not to test."
applyTo: ["**/*.test.ts", "src/test/**"]
---
# Testing Requirements

## Framework
- Test framework: VS Code test runner (`@vscode/test-electron`)
- Test location: `src/test/`
- Test command: `npm test`

## Requirements
- New features must include at least one test
- Bug fixes must include a regression test
- Both XML and Java parser paths should be tested for parsing changes
- Multi-root workspace path resolution must be tested with both single-folder and multi-root scenarios

## Test Structure
```typescript
suite('ComponentName', () => {
    test('should describe expected behavior', () => {
        // Arrange
        const input = ...;
        // Act
        const result = doSomething(input);
        // Assert
        assert.strictEqual(result, expected);
    });
});
```

## What to Test
- `AntParserService`: Parse various build.xml formats (simple, with imports, with properties)
- `AntTaskService`: Path resolution, task config generation, task CRUD operations
- `antTypes.ts`: Type validation — ensure parsed JSON matches interface shapes
- Edge cases: Empty targets, circular imports, invalid XML, missing files

## What NOT to Test
- VS Code API behavior (mock it instead)
- Webview HTML rendering (use Webview DevTools for visual testing)
- Java parser internals (test via the TypeScript integration layer)
