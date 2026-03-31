---
name: webview-development
description: "VS Code webview development — Content Security Policy, nonce generation, message passing, HTML generation, VS Code CSS variables, panel singleton lifecycle. Use when creating or modifying webview panels."
---
# Webview Development

## When to Use
- Creating new webview panels
- Adding UI elements to existing panels
- Implementing extension ↔ webview communication
- Fixing CSP or styling issues
- Adding interactive features (drag-drop, forms, selections)

## Panel Structure

### Singleton Pattern
```typescript
export class MyPanel {
    public static currentPanel: MyPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;

    public static createOrShow(extensionUri: vscode.Uri, ...services) {
        if (MyPanel.currentPanel) {
            MyPanel.currentPanel._panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'myPanelId', 'Panel Title',
            vscode.ViewColumn.One,
            { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] }
        );
        MyPanel.currentPanel = new MyPanel(panel, extensionUri, ...services);
    }
}
```

### Content Security Policy
Every webview MUST have a nonce-based CSP:
```typescript
private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce(); // crypto.randomBytes or similar
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css'));

    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy"
              content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
        <link href="${styleUri}" rel="stylesheet">
    </head>
    <body>
        <!-- content -->
        <script nonce="${nonce}">
            const vscode = acquireVsCodeApi();
            // webview JavaScript here
        </script>
    </body>
    </html>`;
}
```

## Message Passing

### Webview → Extension
```javascript
// In webview JavaScript
vscode.postMessage({ command: 'saveTask', data: { name: taskName, targets: selectedTargets } });
```

### Extension → Webview
```typescript
// In panel class
this._panel.webview.postMessage({ command: 'updateTargets', targets: parsedTargets });
```

### Message Handler (Extension Side)
```typescript
this._panel.webview.onDidReceiveMessage(
    message => {
        switch (message.command) {
            case 'saveTask':
                this._taskService.saveTaskToWorkspace(message.data);
                break;
            case 'cancel':
                this._panel.dispose();
                break;
        }
    },
    undefined, this._disposables
);
```

## Styling with VS Code Variables
```css
body {
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
}
button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
}
button:hover {
    background-color: var(--vscode-button-hoverBackground);
}
```

## Lifecycle
- `onDidDispose`: Clean up, set `currentPanel = undefined`
- `onDidChangeViewState`: Panel visibility changed (active/inactive)
- Webviews lose state when hidden — use `webview.setState()` / `getState()` or re-post from extension
