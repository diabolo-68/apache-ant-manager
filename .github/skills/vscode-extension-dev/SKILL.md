---
name: vscode-extension-dev
description: "VS Code extension development patterns — activation events, command registration, webview API, Task API, ExtensionContext, multi-root workspaces. Use when adding commands, settings, menus, or extension lifecycle features."
---
# VS Code Extension Development

## When to Use
- Adding new commands to `package.json` and `extension.ts`
- Registering configuration settings
- Working with the VS Code Task API
- Managing extension activation and lifecycle
- Adding menus, keybindings, or context menu entries

## Extension Lifecycle

### Activation
Configured in `package.json`:
```json
"activationEvents": ["workspaceContains:**/build.xml"]
```
The extension activates lazily when a `build.xml` exists anywhere in the workspace.

### Command Registration
```typescript
export function activate(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('apache-ant-manager.commandName', async (uri) => {
        // Command logic here
    });
    context.subscriptions.push(disposable);
}
```

### Extension Context
`context.extensionUri` provides the extension's install directory — used for webview resource URIs.
`context.subscriptions` collects disposables for cleanup on deactivation.

## Task API

### Creating Tasks
```typescript
const taskDefinition: vscode.TaskDefinition = { type: 'shell' };
const execution = new vscode.ShellExecution(command, args, options);
const task = new vscode.Task(taskDefinition, folder, label, 'ant', execution);
await vscode.tasks.executeTask(task);
```

### tasks.json Integration
Tasks are stored in `.vscode/tasks.json` (per-folder) or `.code-workspace` file:
```json
{
    "label": "ant: build",
    "type": "shell",
    "command": "ant",
    "args": ["build"],
    "options": {
        "cwd": "${workspaceFolder}",
        "env": { "ANT_HOME": "/path/to/ant" }
    }
}
```

## Configuration Settings
Defined in `package.json` → `contributes.configuration`:
```json
{
    "apacheAntManager.settingName": {
        "type": "string",
        "default": "",
        "description": "Setting description"
    }
}
```
Read via: `vscode.workspace.getConfiguration('apacheAntManager').get('settingName')`

## Multi-Root Workspace
```typescript
const folders = vscode.workspace.workspaceFolders;
if (folders && folders.length > 1) {
    // Multi-root: use ${workspaceFolder:NAME} syntax
} else {
    // Single-folder: use ${workspaceFolder} syntax
}
```

## Package.json Commands
```json
{
    "contributes": {
        "commands": [{
            "command": "apache-ant-manager.commandName",
            "title": "Command Title",
            "category": "Apache Ant",
            "icon": "$(icon-name)"
        }]
    }
}
```
