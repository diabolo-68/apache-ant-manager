# Changelog

All notable changes to the "Task Studio" extension (formerly "Apache Ant Manager") will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-11-17

### Added

- **Script and command tasks** - Create tasks for shell, batch, PowerShell, Python and Node.js scripts, and custom commands, with interpreter suggestions (incl. Python virtual environments), arguments, environment variables, terminal and task-group options
- **Task Studio view** in the Explorer with inline run / edit, duplicate, delete and per-target run for Ant tasks
- **Re-run last task** status bar item
- **Command preview**, **Save & Run** and keyboard shortcuts (Ctrl+S, Ctrl+Enter) in the task editors
- New-task flow lists matching files found in the workspace
- Test suites: unit tests (mocha), integration tests in VS Code (@vscode/test-cli) and Playwright end-to-end tests, run on Linux, Windows and macOS in CI
- Platform tests that create and run every script kind the current OS supports (Batch and PowerShell on Windows, shell scripts on Linux/macOS, Python and Node.js everywhere), including script paths and arguments with spaces
- Animated GIF of the new-task flow in the README, recorded by `npm run screenshots`
- Publishing scripts (`publish.ps1`, `publish.js`, `npm run publish:*`) that package one `.vsix` and publish it to the VS Code Marketplace and OpenVSX, plus `toolkit.ps1`, an interactive menu for tests, screenshots, packaging and publishing

### Changed

- Renamed to **Task Studio — Scripts, Commands & More** (extension ID, command IDs and `apacheAntManager.*` settings are unchanged, so existing installs and tasks keep working)
- Redesigned Ant task editor: single filterable target list with drag-and-drop ordering, structured arguments, collapsible environment section, inline validation, sticky action bar
- Task list grouped by workspace folder with relative paths and hover actions
- Native look: emoji replaced with VS Code codicons
- Commands are now in the "Task Studio" category

### Fixed

- `tasks.json` files containing comments (VS Code's default template) were read as empty and overwritten on the next save. They are now parsed as JSONC, comments and formatting are kept, and a file that cannot be parsed is never rewritten
- Self-closing `<target …/>` elements made the XML parser skip the following target
- Quoted Ant arguments (`-Dmsg="hello world"`) were stored with literal quotes and could be mistaken for targets
- Editing a task no longer moves it to the end of `tasks.json`
- A workspace folder whose name starts with another folder's name (`app` / `app-lib`) is no longer treated as inside it
- Script tasks created on Linux now also run on Windows (and vice versa): default interpreters are stored with a `windows` override
- Running a task now picks the task from the right workspace folder when several folders have a task with the same name
- Switching the build file in the editor no longer discards the other form values

## [1.0.0] - 2026-01-11

### Added

- **Visual Configuration UI** - Modern webview-based interface for configuring Ant tasks
- **Build File Browser** - Browse and select Ant build.xml files from your workspace
- **Target Discovery** - Automatically parse and display available targets with descriptions and dependencies
- **Execution Order Management** - Define and reorder target execution sequence with up/down buttons
- **Task Generation** - Generate VS Code tasks.json entries for Ant configurations
- **Tree View Provider** - Browse Ant targets directly in the Explorer sidebar
- **Environment Settings** - Configure working directory, ANT_HOME, JAVA_HOME, and terminal shell
- **Shell Selection** - Choose between PowerShell, Command Prompt, Bash, sh, Zsh, or WSL
- **Multi-Root Workspace Support** - Manage tasks across multiple workspace folders with folder badges
- **Workspace-Level Tasks** - Save tasks to the workspace file for shared configurations across folders
- **Task Moving** - Move tasks between workspace folders when editing
- **Fast XML Parser** - Default XML-based parser for quick target discovery
- **Import Depth Control** - Configure how deep to follow import/include statements
- **Java Parser Option** - Optional Java-based parser for advanced Ant property resolution
- **Loading Indicators** - Visual feedback during build file parsing
- **Compact Target Grid** - Efficient multi-column layout for target selection
- **Additional Arguments** - Support for custom Ant arguments and properties
- **Context Menu Integration** - Right-click on build.xml files to open configuration

### Configuration Options

- `apacheAntManager.antHome` - Path to Apache Ant installation directory
- `apacheAntManager.javaHome` - Path to Java installation directory
- `apacheAntManager.importDepth` - Maximum depth for following imports (default: 2)
- `apacheAntManager.useJavaParser` - Use Java parser instead of fast XML parser (default: false)

---

## Planned

- Build file templates
- Recent build files history