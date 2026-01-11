# Changelog

All notable changes to the "Apache Ant Manager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [Unreleased]

### Planned

- Drag-and-drop target reordering
- Target filtering and search
- Build file templates
- Recent build files history
- Keyboard shortcuts