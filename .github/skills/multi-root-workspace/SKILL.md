---
name: multi-root-workspace
description: "VS Code multi-root workspace patterns — path resolution with ${workspaceFolder:NAME}, per-folder vs workspace-level tasks, folder detection, workspace file handling. Use when working with paths or task storage."
---
# Multi-Root Workspace Patterns

## When to Use
- Handling file paths that need to work in both single-folder and multi-root workspaces
- Saving or reading tasks from correct location (folder vs workspace file)
- Displaying workspace folder information in UI
- Converting between absolute and workspace-relative paths

## Path Resolution

### Single-Folder Workspace
```
Absolute:   C:\projects\myapp\build.xml
Relative:   ${workspaceFolder}/build.xml
```

### Multi-Root Workspace
```
Absolute:   C:\projects\frontend\build.xml
Relative:   ${workspaceFolder:frontend}/build.xml
```

### Conversion Methods
```typescript
// Absolute → Workspace Relative
const relativePath = AntTaskService.toWorkspaceRelativePath(absolutePath);
// Returns "${workspaceFolder}/build.xml" or "${workspaceFolder:frontend}/build.xml"

// Workspace Relative → Absolute
const absolutePath = AntTaskService.resolveWorkspacePath(relativePath);
// Returns "C:\projects\frontend\build.xml"
```

## Task Storage

### Single-Folder
Tasks saved in: `<workspace>/.vscode/tasks.json`

### Multi-Root — Per-Folder
Tasks saved in: `<folder>/.vscode/tasks.json`
- Each workspace folder has its own tasks.json
- Tasks reference files relative to their folder

### Multi-Root — Workspace-Level
Tasks saved in: `<name>.code-workspace` file under `"tasks"` key
- Shared across all folders
- Must use `${workspaceFolder:NAME}` syntax for paths

## Detection
```typescript
const folders = vscode.workspace.workspaceFolders;
const isMultiRoot = folders && folders.length > 1;
const workspaceFile = vscode.workspace.workspaceFile; // .code-workspace path or undefined
```

## UI Patterns

### Folder Badges
In task lists, show which folder a task belongs to:
```html
<span class="folder-badge">frontend</span>
<span class="folder-badge workspace-level">🗂️ Workspace</span>
```

### Folder Selection
When creating tasks in multi-root, let user choose the target folder:
```typescript
const folder = await vscode.window.showQuickPick(
    folders.map(f => ({ label: f.name, folder: f })),
    { placeHolder: 'Select workspace folder' }
);
```

## Common Pitfalls
- Never hardcode folder index 0 as "the" workspace folder
- Always check `workspaceFolders` is not undefined before accessing
- Use `path.relative()` carefully — it produces OS-specific separators
- Workspace-relative paths in tasks.json use forward slashes on all platforms
