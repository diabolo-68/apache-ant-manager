# Apache Ant Manager - VS Code Extension

## Architecture Overview

This extension follows a **dual-runtime architecture**: TypeScript for VS Code integration, Java for Ant parsing.

### Component Flow
```
User → VS Code Commands → Panels (Webview UI) → Services → Java Parser (child process)
                              ↓
                          tasks.json
```

### Key Components
- **Panels** (`src/panels/`): Webview-based UI using VS Code's webview API with inline HTML generation
- **Services** (`src/services/`): Business logic - `AntParserService` (Java invocation + XML fallback), `AntTaskService` (tasks.json management)
- **Java Parser** (`java/`): Maven project using Apache Ant libraries to parse build.xml files

### Data Flow
1. `AntParserService` spawns `java -cp ant-parser.jar com.vscode.ant.AntParser <build.xml>`
2. Java parser outputs JSON to stdout → TypeScript parses it into `AntBuildInfo`
3. Falls back to XML regex parsing if Java fails (see `parseWithXml` method)

## Development Workflow

```bash
# First-time setup
npm install
cd java && mvn package && cd ..

# Active development (run both)
npm run watch          # TypeScript compilation
# Press F5 to debug extension

# Rebuild Java parser after changes
cd java && mvn package
```

## Code Patterns

### Webview Communication
Panels use message passing - follow this pattern:
```typescript
// Panel → Webview: _panel.webview.postMessage({ command: 'setDirectory', ... })
// Webview → Panel: message handler in constructor switch statement
```

### Path Resolution
Use `${workspaceFolder}` for workspace-relative paths:
- `AntTaskService.toWorkspaceRelativePath()` converts absolute paths to `${workspaceFolder}/...`
- `AntTaskService.resolveWorkspacePath()` resolves `${workspaceFolder}` back to absolute paths

### Service Instantiation
Services are created in `extension.ts` and passed to panels - avoid creating new instances in panels.

### Types
All Ant-related interfaces are in `src/types/antTypes.ts`. The Java `AntBuildInfo`/`AntTarget` classes mirror these types.

## File Organization
- `extension.ts` - Command registration and service wiring (entry point)
- `panels/*.ts` - Each panel has `_getHtmlForWebview()` generating inline HTML/CSS/JS
- `services/AntTaskService.ts` - CRUD operations on `tasks.json`
- `media/style.css` - Shared webview styles using VS Code CSS variables

## Testing & Debugging
- Debug with F5 (uses `.vscode/launch.json`)
- Test Java parser standalone: `java -jar java/target/ant-parser.jar <build.xml>`
- Check webview dev tools: Command Palette → "Developer: Open Webview Developer Tools"

## Important Conventions
- All task configuration uses standard VS Code task properties (options.cwd, options.env, options.shell)
- Workspace paths use simple `${workspaceFolder}` syntax (resolves to first workspace folder)
- Java parser captures stdout/stderr to prevent Ant logging from corrupting JSON output
