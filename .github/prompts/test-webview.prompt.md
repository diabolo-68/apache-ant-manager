---
description: "Test and debug webview panels in the Extension Development Host. Covers task list panel, configuration panel, DevTools, and edge cases."
agent: "agent"
---
Test and debug webview panels in the Extension Development Host.

## Steps

1. **Launch the extension**: Press F5 to start the Extension Development Host
2. **Open a workspace** with a `build.xml` file (or create a sample one)
3. **Test the task list panel**:
   - Run command: "Apache Ant: Manage Tasks"
   - Verify tasks load correctly
   - Test Run/Edit/Delete buttons
   - Check folder badges in multi-root workspaces
4. **Test the configuration panel**:
   - Create a new task or edit existing
   - Verify build file selector works
   - Check target checkboxes render correctly
   - Test execution order drag buttons
   - Verify environment settings (working dir, ANT_HOME, JAVA_HOME, shell)
   - Save and verify tasks.json output
5. **Test webview DevTools**: Command Palette → "Developer: Open Webview Developer Tools"
   - Check for console errors
   - Verify CSP headers are present
   - Test message passing in Network tab
6. **Test edge cases**:
   - Empty build.xml (no targets)
   - Build.xml with imports/includes
   - Invalid XML file
   - Very large target lists
