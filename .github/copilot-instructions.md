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
| Component | Location | Purpose |
|-----------|----------|---------|
| `extension.ts` | `src/` | Entry point, command registration, service wiring |
| `AntConfigurationPanel` | `src/panels/` | Task editing UI (new/edit Ant tasks) |
| `AntTasksListPanel` | `src/panels/` | Task list view with run/edit/delete |
| `AntParserService` | `src/services/` | Build.xml parsing (Java + XML fallback) |
| `AntTaskService` | `src/services/` | CRUD for tasks.json, run tasks |
| `AntParser.java` | `java/` | Maven project using Apache Ant libraries |

### Data Flow
1. `AntParserService` spawns `java -cp ant-parser.jar com.vscode.ant.AntParser <build.xml>`
2. Java parser outputs JSON to stdout → TypeScript parses it into `AntBuildInfo`
3. Falls back to XML regex parsing if Java fails (see `parseWithXml()` method)
4. Parsed targets displayed in webview, user configuration saved to `tasks.json`

## Development Workflow

```powershell
# First-time setup
npm install
cd java; mvn package; cd ..

# Active development
npm run watch          # TypeScript watch mode (uses tsc)
# Press F5 to debug extension

# Rebuild Java parser after changes
cd java; mvn package
```

## Code Patterns

### Webview Communication
Panels use bidirectional message passing:
```typescript
// Extension → Webview
this._panel.webview.postMessage({ command: 'setDirectory', target: 'antHome', path: '/path' });

// Webview → Extension (in _getHtmlForWebview() JS)
vscode.postMessage({ command: 'saveTask', taskName: name, targets: [...] });

// Extension handler (in constructor's onDidReceiveMessage switch)
case 'saveTask':
    this._taskService.saveTaskToWorkspace(taskConfig);
    break;
```

### Panel Singleton Pattern
Both panels use `createOrShow()` pattern to prevent duplicate instances:
```typescript
public static currentPanel: AntConfigurationPanel | undefined;
public static createOrShow(...) {
    if (AntConfigurationPanel.currentPanel) {
        AntConfigurationPanel.currentPanel._panel.reveal();
        return;
    }
    // Create new panel...
}
```

### Path Resolution
Multi-root workspaces use `${workspaceFolder:NAME}` syntax:
- `AntTaskService.toWorkspaceRelativePath()` - absolute → `${workspaceFolder:folder}/relative`
- `AntTaskService.resolveWorkspacePath()` - resolves back to absolute paths
- Single-folder workspaces use simple `${workspaceFolder}` syntax

### Service Dependency Injection
Services are instantiated in `extension.ts` and passed to panels - never create services in panels:
```typescript
// extension.ts
const parserService = new AntParserService(context);
const taskService = new AntTaskService();
AntConfigurationPanel.createOrShow(extensionUri, parserService, taskService, buildFilePath, editContext);
```

### Parser Strategy
`AntParserService` uses strategy pattern with fallback:
- **Java Parser** (optional): Resolves Ant properties, follows all imports. Enable via `apacheAntManager.useJavaParser` setting.
- **XML Parser** (default): Fast regex-based parsing, follows imports up to `importDepth` limit.

Both return identical `AntBuildInfo` structure defined in `src/types/antTypes.ts`.

### Type Mirroring
TypeScript and Java types must stay synchronized:
- `src/types/antTypes.ts` → `AntBuildInfo`, `AntTarget`, `AntLaunchConfiguration`
- `java/.../AntBuildInfo.java`, `AntTarget.java` → Same structure, output as JSON

## File Organization
```
src/
├── extension.ts          # Commands: openConfiguration, selectBuildFile, runTargets, refresh
├── panels/
│   ├── AntConfigurationPanel.ts   # Task editor (627 lines)
│   └── AntTasksListPanel.ts       # Task list (364 lines)
├── services/
│   ├── AntParserService.ts        # Build.xml parsing (277 lines)
│   └── AntTaskService.ts          # tasks.json CRUD (799 lines)
├── types/antTypes.ts              # Shared interfaces
└── resources/                     # Screenshots for README
java/
├── pom.xml                        # Maven config (JDK 11+, Ant 1.10.14)
└── src/main/java/com/vscode/ant/
    ├── AntParser.java             # Main entry point
    ├── AntBuildInfo.java          # Output DTO
    └── AntTarget.java             # Target DTO
media/
└── style.css                      # Webview styles using VS Code CSS variables
```

## Testing & Debugging
- **F5**: Launch Extension Development Host
- **Java parser standalone**: `java -jar java/target/ant-parser.jar <build.xml>`
- **Webview DevTools**: Command Palette → "Developer: Open Webview Developer Tools"

## Important Conventions
- **Task storage**: Uses standard VS Code task properties (`options.cwd`, `options.env`, `options.shell`)
- **Multi-root support**: Tasks can be saved per-folder or to `.code-workspace` file
- **Java stdout capture**: Java parser redirects stdout/stderr during Ant initialization to prevent log corruption
- **Build file validation**: `isAntBuildFile()` in extension.ts checks for DOCTYPE/project element before parsing
- **Cache**: Parser caches results for 30 seconds (`cacheTimeout` in AntParserService)

## Configuration Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `apacheAntManager.antHome` | `""` | ANT_HOME path for custom tasks/libraries |
| `apacheAntManager.javaHome` | `""` | JAVA_HOME path if not in PATH |
| `apacheAntManager.importDepth` | `2` | Max depth for following import/include |
| `apacheAntManager.useJavaParser` | `false` | Use Java parser instead of fast XML parser |

## Available Skills

Specialized domain knowledge is available in `.github/skills/`:

| Skill | Path | When to Use |
|-------|------|-------------|
| VS Code Extension Dev | `.github/skills/vscode-extension-dev/` | Activation, commands, Task API, settings, multi-root |
| Webview Development | `.github/skills/webview-development/` | CSP, message passing, singleton pattern, CSS variables |
| Ant Parsing | `.github/skills/ant-parsing/` | Build.xml structure, imports, dual parser strategy |
| Multi-Root Workspace | `.github/skills/multi-root-workspace/` | Path resolution, task storage, folder detection |

## Custom Agents

Specialized agents are available in `.github/agents/`:

| Agent | Purpose |
|-------|---------|
| planner | Feature planning and architecture analysis |
| code-reviewer | Code quality, pattern compliance, and security review |
| tdd-guide | Test-driven development workflow |
| webview-specialist | Webview panel development and CSP |
| java-parser-specialist | Java Ant parser maintenance |
| build-error-resolver | TypeScript/Webpack and Java/Maven build error diagnosis |
| doc-updater | Documentation synchronization |
