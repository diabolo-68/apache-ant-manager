---
description: "Use when editing services — AntParserService, AntTaskService, path resolution, caching, task CRUD, parser strategy pattern."
applyTo: "src/services/**"
---
# Service Development

## Dependency Injection
Services are created in `extension.ts` and injected into panels. Never create services inside panels or other services.

## AntParserService Patterns
- **Cache**: Results cached for 30 seconds per file. Use `clearCache(filePath)` to invalidate.
- **Strategy pattern**: `parseBuildFile()` tries Java parser first (if enabled), falls back to XML parser.
- **XML parser**: Recursive `parseXmlFile()` follows imports up to `importDepth` limit with circular import detection.
- **Java parser**: Spawns `java -cp` child process, captures JSON from stdout.

## AntTaskService Patterns
- **Path resolution**: Always use `toWorkspaceRelativePath()` when saving paths, `resolveWorkspacePath()` when reading.
- **Multi-root**: Check `isMultiRootWorkspace()`. Use `${workspaceFolder:NAME}` for multi-root, `${workspaceFolder}` for single.
- **Task CRUD**: Tasks live in `.vscode/tasks.json` (per-folder) or `.code-workspace` file (workspace-level).
- **Execution**: Use VS Code Task API (`vscode.tasks.executeTask()`), never spawn processes directly.

## Error Handling
- Services should throw descriptive errors, not return null/undefined for failures
- Parser errors should include the file path and line number when possible
- File I/O errors should distinguish between "file not found" and "permission denied"

## No UI in Services
Services must not import `vscode.window` (except for `showErrorMessage` in rare cases). All UI interactions go through panels.
