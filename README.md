# Apache Ant Manager

A Visual Studio Code extension that provides a graphical UI for configuring Apache Ant build tasks, similar to Eclipse's Ant launcher configuration.

## Features

- 🐜 **Visual Configuration UI** - Configure Ant tasks using a modern webview interface
- 📂 **Build File Selection** - Browse and select Ant build.xml files
- 🎯 **Target Discovery** - Automatically parse and display available targets
- ⬆️⬇️ **Execution Order** - Define the order in which targets should be executed
- 💾 **Task Generation** - Generate VS Code tasks.json entries for your Ant configurations
- 🌳 **Tree View** - Browse Ant targets directly in the Explorer sidebar
- ⚙️ **Property Support** - Define custom Ant properties for your builds

## Installation

1. Install from the VS Code Marketplace (coming soon)
2. Or build from source (see Development section)

## Usage

### Opening the Configuration UI

1. **From Command Palette**: Press `Ctrl+Shift+P` and run "Ant: Open Ant Configuration"
2. **From Explorer**: Right-click on a `build.xml` file and select "Open Ant Configuration"
3. **From Tree View**: Use the Ant Targets view in the Explorer sidebar

### Configuring a Build

1. Select your `build.xml` file using the Browse button
2. Check the targets you want to run
3. Use the ▲/▼ buttons to arrange execution order
4. Add any required properties
5. Click **Run** to execute immediately, or **Save as Task** to create a VS Code task

## Requirements

- **Java Runtime Environment (JRE) 11+** - Required for the Ant parser component
- **Apache Ant** - Should be installed and optionally configured in settings

## Extension Settings

This extension contributes the following settings:

* `apacheAntManager.antHome`: Path to Apache Ant installation directory
* `apacheAntManager.javaHome`: Path to Java installation directory

## Building the Java Parser

The extension includes a Java component for parsing Ant build files:

```bash
cd java
mvn package
```

This creates `ant-parser.jar` in `java/target/`.

## Development

### Prerequisites

- Node.js 18+
- Java JDK 11+
- Maven 3.6+

### Building

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Build Java component
cd java
mvn package
cd ..

# Run in debug mode
# Press F5 in VS Code
```

### Project Structure

```
apache-ant-manager/
├── src/                    # TypeScript extension source
│   ├── extension.ts        # Extension entry point
│   ├── panels/             # Webview panels
│   ├── providers/          # Tree view providers
│   ├── services/           # Business logic services
│   └── types/              # TypeScript type definitions
├── java/                   # Java Ant parser component
│   ├── pom.xml
│   └── src/main/java/
├── media/                  # Webview CSS and assets
└── .vscode/                # VS Code configuration
```

## Commands

| Command | Description |
|---------|-------------|
| `Ant: Open Ant Configuration` | Open the configuration UI |
| `Ant: Select Ant Build File` | Select a build.xml file |
| `Ant: Run Ant Targets` | Run selected targets |
| `Ant: Refresh` | Refresh the targets tree view |

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
