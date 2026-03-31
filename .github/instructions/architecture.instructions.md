---
description: "Use when modifying extension architecture — service dependency injection, singleton panels, webview communication, path resolution, parser strategy, or extension.ts wiring."
---
# Architecture Patterns

## Service Dependency Injection
Services are instantiated ONLY in `extension.ts` and passed to panels via constructors. Panels never create service instances.

```typescript
// ✅ Correct — in extension.ts
const parserService = new AntParserService(context);
const taskService = new AntTaskService();
AntConfigurationPanel.createOrShow(uri, parserService, taskService, path, ctx);

// ❌ Wrong — in a panel
const service = new AntTaskService(); // NEVER do this
```

## Panel Singleton Pattern
Every webview panel class must implement the singleton `createOrShow()` static method. Never allow multiple instances of the same panel type.

## Webview Communication
All extension ↔ webview communication uses `postMessage`. Define a command string for each message type. Handle messages in a `switch/case` block in the panel constructor. Never pass complex objects that can't be serialized to JSON.

## Path Resolution
All file paths stored in `tasks.json` must use workspace-relative format:
- Single-folder: `${workspaceFolder}/relative/path`
- Multi-root: `${workspaceFolder:FolderName}/relative/path`

Use `AntTaskService.toWorkspaceRelativePath()` to convert absolute paths. Use `AntTaskService.resolveWorkspacePath()` to convert back.

## Parser Strategy
`AntParserService` supports two parsing strategies. Both must return identical `AntBuildInfo` structure. When making parser changes:
1. Update the XML parser (default)
2. Update the Java parser (if applicable)
3. Verify both return the same output for the same input

## No Logic in Extension.ts
`extension.ts` is for command registration and service wiring only. Business logic belongs in services. UI logic belongs in panels.
