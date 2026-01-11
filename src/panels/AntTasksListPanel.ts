import * as vscode from 'vscode';
import { AntTaskService, AntTaskConfig } from '../services/AntTaskService';
import { AntParserService } from '../services/AntParserService';

/**
 * Webview panel for listing and managing Ant tasks.
 * Shows all configured Ant tasks with options to add, edit, or delete.
 */
export class AntTasksListPanel {
    public static currentPanel: AntTasksListPanel | undefined;
    public static readonly viewType = 'antTasksList';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _taskService: AntTaskService;
    private readonly _parserService: AntParserService;
    private _disposables: vscode.Disposable[] = [];

    // Callback for opening the editor
    private _onEditTask: ((task: AntTaskConfig | null, isNew: boolean) => void) | undefined;

    public static createOrShow(
        extensionUri: vscode.Uri,
        taskService: AntTaskService,
        parserService: AntParserService,
        onEditTask: (task: AntTaskConfig | null, isNew: boolean) => void
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (AntTasksListPanel.currentPanel) {
            AntTasksListPanel.currentPanel._panel.reveal(column);
            AntTasksListPanel.currentPanel._onEditTask = onEditTask;
            AntTasksListPanel.currentPanel.refresh();
            return AntTasksListPanel.currentPanel;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            AntTasksListPanel.viewType,
            'Ant Tasks',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ],
                retainContextWhenHidden: true
            }
        );

        AntTasksListPanel.currentPanel = new AntTasksListPanel(
            panel,
            extensionUri,
            taskService,
            parserService,
            onEditTask
        );

        return AntTasksListPanel.currentPanel;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        taskService: AntTaskService,
        parserService: AntParserService,
        onEditTask: (task: AntTaskConfig | null, isNew: boolean) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._taskService = taskService;
        this._parserService = parserService;
        this._onEditTask = onEditTask;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'addTask':
                        if (this._onEditTask) {
                            this._onEditTask(null, true);
                        }
                        break;
                    case 'editTask':
                        const tasks = this._taskService.getAntTasks();
                        const taskToEdit = tasks.find(t => t.label === message.label);
                        if (taskToEdit && this._onEditTask) {
                            const parsed = this._taskService.parseAntTask(taskToEdit);
                            // Preserve the workspace folder info for editing
                            (parsed as any)._workspaceFolder = (taskToEdit as any)._workspaceFolder;
                            (parsed as any)._workspaceFolderName = (taskToEdit as any)._workspaceFolderName;
                            (parsed as any)._isWorkspaceLevel = (taskToEdit as any)._isWorkspaceLevel;
                            this._onEditTask(parsed, false);
                        }
                        break;
                    case 'deleteTask':
                        const confirm = await vscode.window.showWarningMessage(
                            `Are you sure you want to delete task "${message.label}"?`,
                            { modal: true },
                            'Delete'
                        );
                        if (confirm === 'Delete') {
                            try {
                                // Pass the folder name to correctly locate the task
                                await this._taskService.deleteTask(message.label, message.folderName);
                                this.refresh();
                            } catch (error) {
                                vscode.window.showErrorMessage(`Failed to delete task: ${error}`);
                            }
                        }
                        break;
                    case 'runTask':
                        // Run the saved task from tasks.json by its label
                        await this._taskService.runSavedTask(message.label);
                        break;
                    case 'refresh':
                        this.refresh();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public refresh(): void {
        this._update();
    }

    private _update(): void {
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );

        const nonce = getNonce();

        const tasks = this._taskService.getAntTasks();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const isMultiRoot = (workspaceFolders && workspaceFolders.length > 1) || this._taskService.isMultiRootWorkspace();
        
        const tasksHtml = tasks.length > 0 
            ? tasks.map(task => {
                const parsed = this._taskService.parseAntTask(task);
                const folderName = (task as any)._workspaceFolderName;
                const isWorkspaceLevel = (task as any)._isWorkspaceLevel;
                const badgeText = isWorkspaceLevel ? '🗂️ Workspace' : folderName;
                const folderBadge = isMultiRoot && badgeText ? `<span class="folder-badge${isWorkspaceLevel ? ' workspace-level' : ''}">${escapeHtml(badgeText)}</span>` : '';
                return `
                    <div class="task-item" data-label="${escapeHtml(task.label)}" data-folder="${escapeHtml(folderName || '')}" data-workspace-level="${isWorkspaceLevel ? 'true' : 'false'}">
                        <div class="task-info">
                            <div class="task-name">${folderBadge}${escapeHtml(task.label)}</div>
                            <div class="task-details">
                                <span class="task-buildfile">📄 ${escapeHtml(parsed.buildFile || 'Unknown')}</span>
                                <span class="task-targets">🎯 ${parsed.targets?.map(escapeHtml).join(', ') || 'No targets'}</span>
                            </div>
                        </div>
                        <div class="task-actions">
                            <button class="action-btn run-btn" data-label="${escapeHtml(task.label)}" title="Run">▶</button>
                            <button class="action-btn edit-btn" data-label="${escapeHtml(task.label)}" title="Edit">✏️</button>
                            <button class="action-btn delete-btn" data-label="${escapeHtml(task.label)}" data-folder="${escapeHtml(folderName || '')}" title="Delete">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('')
            : '<div class="no-tasks"><p>No Ant tasks configured yet.</p><p>Click "Add New Task" to create your first Ant task.</p></div>';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Ant Tasks</title>
    <style>
        .task-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            transition: background-color 0.1s;
        }
        .task-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .task-info {
            flex: 1;
        }
        .task-name {
            font-weight: 600;
            font-size: 1.05em;
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .folder-badge {
            font-size: 0.75em;
            font-weight: 500;
            padding: 2px 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
        }
        .folder-badge.workspace-level {
            background: var(--vscode-statusBarItem-prominentBackground, var(--vscode-activityBarBadge-background));
            color: var(--vscode-statusBarItem-prominentForeground, var(--vscode-activityBarBadge-foreground));
        }
        .task-details {
            display: flex;
            gap: 16px;
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        .task-actions {
            display: flex;
            gap: 8px;
        }
        .action-btn {
            padding: 6px 10px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
        }
        .action-btn:hover {
            opacity: 0.85;
        }
        .run-btn:hover {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .delete-btn:hover {
            background: var(--vscode-inputValidation-errorBackground);
        }
        .no-tasks {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .no-tasks p {
            margin: 8px 0;
        }
        .header-actions {
            display: flex;
            gap: 10px;
            margin-bottom: 16px;
        }
        .tasks-container {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🐜 Ant Task Manager</h1>
        </header>

        <section>
            <div class="header-actions">
                <button id="addTaskBtn" class="primary">+ Add New Task</button>
                <button id="refreshBtn">🔄 Refresh</button>
            </div>

            <div class="tasks-container">
                ${tasksHtml}
            </div>
        </section>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

        // Add task button
        document.getElementById('addTaskBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'addTask' });
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        // Edit buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const label = e.target.getAttribute('data-label');
                vscode.postMessage({ command: 'editTask', label });
            });
        });

        // Delete buttons
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const label = e.target.getAttribute('data-label');
                const folderName = e.target.getAttribute('data-folder');
                vscode.postMessage({ command: 'deleteTask', label, folderName });
            });
        });

        // Run buttons
        document.querySelectorAll('.run-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const label = e.target.getAttribute('data-label');
                vscode.postMessage({ command: 'runTask', label });
            });
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        AntTasksListPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function escapeHtml(text: string): string {
    if (!text) {return '';}
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
