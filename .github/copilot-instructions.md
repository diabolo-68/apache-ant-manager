# Apache Ant Manager - VS Code Extension

## Project Overview
This VS Code extension provides a graphical UI for configuring Apache Ant build tasks, similar to Eclipse's Ant launcher configuration.

## Features
- Select Ant build.xml script files
- Parse and display available targets from Ant scripts
- Select targets to run and define execution order
- Generate VS Code tasks.json configuration
- Webview-based configuration UI

## Project Structure
- `/src` - TypeScript extension source code
- `/java` - Java component for Ant script parsing using Apache Ant libraries
- `/media` - Webview assets (CSS, icons)
- `/webview` - Webview UI source files

## Development Guidelines
- Use TypeScript for all extension code
- Follow VS Code extension best practices
- Use the VS Code Webview API for the configuration UI
- The Java component should be invoked via child process to parse Ant files

## Commands
- `apache-ant-manager.openConfiguration` - Open the Ant configuration UI
- `apache-ant-manager.selectBuildFile` - Select an Ant build.xml file
- `apache-ant-manager.runTargets` - Run selected Ant targets

## Building
1. Run `npm install` to install dependencies
2. Run `npm run compile` to compile TypeScript
3. Build Java component with `mvn package` in the `/java` directory
4. Press F5 to launch extension in debug mode
