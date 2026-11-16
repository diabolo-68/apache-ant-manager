import * as vscode from 'vscode';
import { AntTaskService, AntTaskConfig } from '../services/AntTaskService';
import { TaskActions, TaskRef, taskRefOf, WORKSPACE_SCOPE } from '../taskActions';
import { displayBuildFile } from '../util/antFiles';
import { SCRIPT_KINDS } from '../types/taskKinds';
import { escapeHtml, icon, renderPage } from './webviewUtils';

/**
 * Webview panel listing all saved Ant tasks, grouped by workspace folder.
 */
export class AntTasksListPanel {
    public static currentPanel: AntTasksListPanel | undefined;
    public static readonly viewType = 'antTasksList';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, actions: TaskActions, taskService: AntTaskService): AntTasksListPanel {
        const column = vscode.window.activeTextEditor?.viewColumn;

        if (AntTasksListPanel.currentPanel) {
            AntTasksListPanel.currentPanel._panel.reveal(column);
            AntTasksListPanel.currentPanel.refresh();
            return AntTasksListPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            AntTasksListPanel.viewType,
            'Tasks',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');

        AntTasksListPanel.currentPanel = new AntTasksListPanel(panel, extensionUri, actions, taskService);
        return AntTasksListPanel.currentPanel;
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        private readonly _actions: TaskActions,
        private readonly _taskService: AntTaskService
    ) {
        this._panel = panel;
        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._actions.onDidChangeTasks(() => this.refresh(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (message) => {
            const ref: TaskRef = { label: message.label, folderName: message.folderName ?? '' };
            switch (message.command) {
                case 'addTask': await this._actions.createNew(); break;
                case 'editTask': this._actions.edit(ref); break;
                case 'runTask': await this._actions.run(ref); break;
                case 'duplicateTask': await this._actions.duplicate(ref); break;
                case 'deleteTask': await this._actions.delete(ref); break;
                case 'refresh': this._actions.notifyChanged(); break;
            }
        }, null, this._disposables);
    }

    public refresh(): void {
        this._update();
    }

    private _update(): void {
        this._panel.webview.html = this._getHtml(this._panel.webview);
    }

    private _details(task: AntTaskConfig): { icon: string; badge: string; details: string } {
        const meta = task.taskManager;
        if (meta) {
            const info = SCRIPT_KINDS[meta.kind] ?? SCRIPT_KINDS.custom;
            const short = (p: string) => p.replace(/^\$\{workspaceFolder(?::[^}]+)?\}[\\/]?/, '');
            const args = meta.scriptArgs?.length ? `<span>${icon('symbol-parameter')}${escapeHtml(meta.scriptArgs.join(' '))}</span>` : '';
            const main = meta.kind === 'custom'
                ? `<span>${icon('terminal')}<code>${escapeHtml(task.command)}</code></span>`
                : `<span title="${escapeHtml(meta.script)}">${icon('file-code')}${escapeHtml(short(meta.script))}</span>
                   <span title="Interpreter">${icon('run')}${escapeHtml(task.command)}</span>`;
            return { icon: info.icon, badge: info.shortLabel, details: main + args };
        }
        const parsed = this._taskService.parseAntTask(task);
        const targets = parsed.targets?.length ? parsed.targets.map(escapeHtml).join(' → ') : '<em>no targets</em>';
        return {
            icon: 'tools',
            badge: 'Ant',
            details: `<span title="${escapeHtml(parsed.buildFile)}">${icon('file-code')}${escapeHtml(displayBuildFile(parsed.rawBuildFile || parsed.buildFile))}</span>
                      <span>${icon('target')}${targets}</span>`
        };
    }

    private _taskRow(task: AntTaskConfig): string {
        const ref = taskRefOf(task);
        const data = `data-label="${escapeHtml(ref.label)}" data-folder="${escapeHtml(ref.folderName)}"`;
        const d = this._details(task);
        return `
        <div class="task-row" tabindex="0" role="button" aria-label="Edit task ${escapeHtml(task.label)}" ${data}>
            ${icon(d.icon)}
            <div class="task-info">
                <div class="task-name">${escapeHtml(task.label)} <span class="badge outline">${escapeHtml(d.badge)}</span></div>
                <div class="task-details">${d.details}</div>
            </div>
            <div class="task-actions">
                <button class="icon-btn" data-action="runTask" ${data} title="Run" aria-label="Run ${escapeHtml(task.label)}">${icon('play')}</button>
                <button class="icon-btn" data-action="editTask" ${data} title="Edit" aria-label="Edit ${escapeHtml(task.label)}">${icon('edit')}</button>
                <button class="icon-btn" data-action="duplicateTask" ${data} title="Duplicate" aria-label="Duplicate ${escapeHtml(task.label)}">${icon('copy')}</button>
                <button class="icon-btn danger" data-action="deleteTask" ${data} title="Delete" aria-label="Delete ${escapeHtml(task.label)}">${icon('trash')}</button>
            </div>
        </div>`;
    }

    private _getHtml(webview: vscode.Webview): string {
        const tasks = this._actions.getTasks();

        // Group by location; preserve workspace folder order, workspace file last.
        const groups = new Map<string, AntTaskConfig[]>();
        for (const task of tasks) {
            const key = taskRefOf(task).folderName;
            groups.set(key, [...(groups.get(key) ?? []), task]);
        }
        const showGroups = groups.size > 1 || (groups.size === 1 && groups.has(WORKSPACE_SCOPE));

        let content: string;
        if (tasks.length === 0) {
            content = `
            <div class="empty-state">
                <div class="state-icon">${icon('tools')}</div>
                <h2>No tasks yet</h2>
                <p>Turn an Ant build, a shell, batch, PowerShell, Python or Node.js script, or any command into a reusable VS Code task.</p>
                <button class="primary" data-action="addTask">${icon('add')} Create your first task</button>
            </div>`;
        } else if (showGroups) {
            content = [...groups.entries()].map(([folderName, list]) => {
                const isWs = folderName === WORKSPACE_SCOPE;
                return `
                <div class="task-group">
                    <div class="task-group-header">${icon(isWs ? 'files' : 'root-folder')} ${escapeHtml(isWs ? 'Workspace (shared)' : folderName)}
                        <span class="badge outline">${list.length}</span></div>
                    <div class="task-list">${list.map(t => this._taskRow(t)).join('')}</div>
                </div>`;
            }).join('');
        } else {
            content = `<div class="task-list">${tasks.map(t => this._taskRow(t)).join('')}</div>`;
        }

        return renderPage(webview, this._extensionUri, {
            title: 'Tasks',
            body: `
            <div class="container">
                <header class="page-header">
                    <h1>${icon('tools')} Tasks</h1>
                    <div class="toolbar">
                        <button class="icon-btn" data-action="refresh" title="Refresh" aria-label="Refresh">${icon('refresh')}</button>
                        <button class="primary" data-action="addTask">${icon('add')} New Task</button>
                    </div>
                </header>
                ${content}
            </div>`,
            script: `
            const vscode = acquireVsCodeApi();
            const post = (command, el) => vscode.postMessage({
                command, label: el && el.dataset.label, folderName: el && el.dataset.folder
            });

            document.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (btn) { e.stopPropagation(); post(btn.dataset.action, btn); return; }
                const row = e.target.closest('.task-row');
                if (row) { post('editTask', row); }
            });

            document.addEventListener('keydown', (e) => {
                const row = e.target.closest && e.target.closest('.task-row');
                if (!row || e.target !== row) { return; }
                if (e.key === 'Enter') { e.preventDefault(); post('editTask', row); }
                else if (e.key === 'Delete') { e.preventDefault(); post('deleteTask', row); }
                else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const rows = [...document.querySelectorAll('.task-row')];
                    const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
                    if (next) { next.focus(); }
                }
            });
            `
        });
    }

    public dispose() {
        AntTasksListPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}
