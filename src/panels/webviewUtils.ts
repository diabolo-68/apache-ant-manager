import * as vscode from 'vscode';

export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function escapeHtml(text: string | undefined | null): string {
    if (!text) { return ''; }
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/** Codicon markup. `name` is a codicon id such as "play" or "trash". */
export function icon(name: string): string {
    return `<i class="codicon codicon-${name}" aria-hidden="true"></i>`;
}

/**
 * Wrap body markup in a full HTML document with the shared stylesheet,
 * the codicon font and a strict CSP.
 */
export function renderPage(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    options: { title: string; body: string; script?: string; nonce?: string }
): string {
    const nonce = options.nonce ?? getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'codicons', 'codicon.css'));
    const csp = [
        `default-src 'none'`,
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `font-src ${webview.cspSource}`,
        `script-src 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${codiconUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>${escapeHtml(options.title)}</title>
</head>
<body>
${options.body}
${options.script ? `<script nonce="${nonce}">${options.script}</script>` : ''}
</body>
</html>`;
}

export function loadingPage(webview: vscode.Webview, extensionUri: vscode.Uri, message: string): string {
    return renderPage(webview, extensionUri, {
        title: 'Loading…',
        body: `<div class="state-container"><div class="spinner" role="progressbar" aria-label="Loading"></div><p>${escapeHtml(message)}</p></div>`
    });
}

/**
 * Error state. Each action renders a button that posts `{ command }` back to the extension.
 */
export function errorPage(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    heading: string,
    message: string,
    actions: { command: string; label: string; primary?: boolean }[] = []
): string {
    const buttons = actions.map(a =>
        `<button class="${a.primary ? 'primary' : 'secondary'}" data-command="${escapeHtml(a.command)}">${escapeHtml(a.label)}</button>`
    ).join('');
    return renderPage(webview, extensionUri, {
        title: 'Error',
        body: `<div class="state-container">
            <div class="state-icon error">${icon('warning')}</div>
            <h2>${escapeHtml(heading)}</h2>
            <p class="error-message">${escapeHtml(message)}</p>
            ${buttons ? `<div class="button-row">${buttons}</div>` : ''}
        </div>`,
        script: actions.length ? `
            const vscode = acquireVsCodeApi();
            document.querySelectorAll('[data-command]').forEach(b =>
                b.addEventListener('click', () => vscode.postMessage({ command: b.dataset.command })));
        ` : undefined
    });
}
