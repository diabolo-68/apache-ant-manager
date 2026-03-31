---
description: "Plan a new feature for the Apache Ant Manager VS Code extension"
agent: "agent"
---
Plan the implementation of the following feature for the Apache Ant Manager VS Code extension:

${{input}}

Analyze the codebase and produce a numbered implementation plan covering:

1. **Affected files** — which components need changes (extension.ts, panels, services, types, Java, package.json, CSS)
2. **Type changes** — new interfaces or fields in `src/types/antTypes.ts` (and mirrored Java DTOs)
3. **Service logic** — new methods or changes in AntParserService / AntTaskService
4. **Webview changes** — new message types, HTML elements, CSS styles
5. **Command registration** — new commands in extension.ts and package.json
6. **Multi-root impact** — does this need per-folder or workspace-level handling?
7. **Implementation order** — ordered by dependency (types → services → panels → extension → package.json)

Reference the [architecture docs](.github/copilot-instructions.md) for project patterns.
