---
description: "Add a new webview message type for extension ↔ webview communication"
agent: "agent"
---
Add a new webview message to the Apache Ant Manager extension:

Message details: ${{input}}

Steps:

1. **Define the message** — choose a `command` string name
2. **Webview → Extension**: Add `vscode.postMessage({ command: '...', ... })` in the webview JavaScript (inside `_getHtmlForWebview()`)
3. **Extension handler**: Add a `case` in the `onDidReceiveMessage` switch block in the panel constructor
4. **Extension → Webview** (if bidirectional): Add `this._panel.webview.postMessage({ command: '...', ... })` call
5. **Webview handler** (if bidirectional): Add handler in the webview's `window.addEventListener('message', ...)` block

Follow [webview communication patterns](.github/copilot-instructions.md):
- All data must be JSON-serializable
- Error states should be communicated back to the webview for display
- Update both the panel source AND its `_getHtmlForWebview()` inline JavaScript
