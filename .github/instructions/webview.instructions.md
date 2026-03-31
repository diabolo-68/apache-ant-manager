---
description: "Use when editing webview panels — HTML generation, CSP nonce, message passing, VS Code CSS variables, singleton pattern, panel lifecycle."
applyTo: "src/panels/**"
---
# Webview Panel Development

## Content Security Policy
Always include a nonce-based CSP in `_getHtmlForWebview()`:
```typescript
const nonce = getNonce(); // Generate unique per render
// In HTML meta tag:
// <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
```

## Message Passing
Define command strings for each message type. Handle in `switch/case`:
```typescript
// Webview → Extension
vscode.postMessage({ command: 'saveTask', taskName: name, targets: [...] });

// Extension → Webview
this._panel.webview.postMessage({ command: 'setDirectory', target: 'antHome', path: '/path' });
```

## Singleton Pattern
Use `createOrShow()` static method. Check `currentPanel` before creating:
```typescript
public static createOrShow(...) {
    if (MyPanel.currentPanel) {
        MyPanel.currentPanel._panel.reveal();
        return;
    }
    // Create new panel...
}
```

## Styling
- Use VS Code CSS variables from `media/style.css`
- Never hardcode colors — always reference `--vscode-*` variables
- Link stylesheet via `webview.asWebviewUri()`

## Panel Lifecycle
- Implement `dispose()` to clean up resources
- Handle `onDidDispose` to set `currentPanel = undefined`
- Webviews are stateless between visibility changes — re-send data when revealed
