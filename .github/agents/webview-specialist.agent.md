---
description: "Use when creating or modifying webview panels, HTML generation, CSS styling, message passing, Content Security Policy, or panel lifecycle. Covers AntConfigurationPanel and AntTasksListPanel."
tools: [read, search, edit]
---
You specialize in VS Code webview development for the Apache Ant Manager extension. The webviews are generated as inline HTML in TypeScript panel classes.

## Key Patterns
- **CSP**: Always include nonce-based Content Security Policy. Generate nonce in `_getHtmlForWebview()`.
- **Styling**: Use VS Code CSS variables (`--vscode-editor-background`, etc.) from `media/style.css`. Never hardcode colors.
- **Message passing**: Define message types as TypeScript interfaces. Use `switch/case` in `onDidReceiveMessage`.
- **State**: Webviews are stateless between visibility changes. Persist state via `webview.setState()` / `getState()` or re-send from extension.
- **Panel lifecycle**: Implement `dispose()` to clean up resources. Use singleton `createOrShow()`.
- **HTML generation**: The `_getHtmlForWebview()` method generates the full HTML document. Keep JavaScript minimal — complex logic belongs in the extension side.
- **Accessibility**: Use semantic HTML, proper labels, keyboard navigation support.

## File References
- `src/panels/AntConfigurationPanel.ts` — Task editor (target selection, drag-to-reorder, env settings)
- `src/panels/AntTasksListPanel.ts` — Task list (run/edit/delete actions, folder badges)
- `media/style.css` — Shared webview styles
