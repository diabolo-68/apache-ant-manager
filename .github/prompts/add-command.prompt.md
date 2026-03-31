---
description: "Add a new VS Code command end-to-end — package.json, extension.ts, panel/service wiring"
agent: "agent"
---
Add a new VS Code command to the Apache Ant Manager extension:

Command details: ${{input}}

Follow these steps:

1. **package.json**: Add command to `contributes.commands` with title, icon, and category "Apache Ant"
2. **package.json**: Add menu entries if needed (editor/title, explorer/context)
3. **extension.ts**: Register the command via `vscode.commands.registerCommand()`
4. **Service layer**: Implement command logic in the appropriate service (AntTaskService or AntParserService)
5. **Panel integration**: If the command opens a UI, use the existing panel singleton pattern

Follow the [architecture patterns](.github/copilot-instructions.md):
- Commands registered in `extension.ts` only
- Business logic in services, not in command handlers
- Use `context.subscriptions.push()` for cleanup
