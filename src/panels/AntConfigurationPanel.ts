import * as vscode from 'vscode';
import * as path from 'path';
import { AntParserService } from '../services/AntParserService';
import { AntTaskService, AntTaskConfig } from '../services/AntTaskService';
import { AntBuildInfo } from '../types/antTypes';

/**
 * Edit mode for the configuration panel.
 */
export interface EditContext {
    isEditMode: boolean;
    originalLabel?: string;
    task?: AntTaskConfig;
    onSaveComplete?: () => void;
}

/**
 * Webview panel for configuring Ant build tasks.
 * Similar to Eclipse's Ant launcher configuration UI.
 */
export class AntConfigurationPanel {
    public static currentPanel: AntConfigurationPanel | undefined;
    public static readonly viewType = 'antConfiguration';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _parserService: AntParserService;
    private readonly _taskService: AntTaskService;
    private _buildFilePath: string;
    private _buildInfo: AntBuildInfo | undefined;
    private _editContext: EditContext;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        parserService: AntParserService,
        taskService: AntTaskService,
        buildFilePath: string,
        editContext?: EditContext
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const ctx = editContext || { isEditMode: false };

        // If we already have a panel, show it
        if (AntConfigurationPanel.currentPanel) {
            AntConfigurationPanel.currentPanel._panel.reveal(column);
            AntConfigurationPanel.currentPanel._editContext = ctx;
            AntConfigurationPanel.currentPanel.updateBuildFile(buildFilePath);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            AntConfigurationPanel.viewType,
            ctx.isEditMode ? 'Edit Ant Task' : 'New Ant Task',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ],
                retainContextWhenHidden: true
            }
        );

        AntConfigurationPanel.currentPanel = new AntConfigurationPanel(
            panel,
            extensionUri,
            parserService,
            taskService,
            buildFilePath,
            ctx
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        parserService: AntParserService,
        taskService: AntTaskService,
        buildFilePath: string,
        editContext: EditContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._parserService = parserService;
        this._taskService = taskService;
        this._buildFilePath = buildFilePath;
        this._editContext = editContext;

        // Show loading state immediately
        this._panel.webview.html = this._getLoadingHtml(panel.webview);

        // Then parse and update
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'saveTask':
                        try {
                            const taskConfig = this._taskService.generateTaskConfig(
                                this._buildFilePath,
                                message.targets,
                                message.taskName,
                                message.additionalArgs || '',
                                message.workingDirectory,
                                message.antHome,
                                message.javaHome,
                                message.shell
                            );
                            
                            // Find the workspace folder by name (or null for workspace-level)
                            const workspaceFolders = vscode.workspace.workspaceFolders || [];
                            const saveToWorkspaceFile = message.workspaceFolderName === '__workspace__';
                            const targetFolder = saveToWorkspaceFile 
                                ? null 
                                : workspaceFolders.find(f => f.name === message.workspaceFolderName);
                            
                            if (this._editContext.isEditMode && this._editContext.originalLabel) {
                                // When editing, we need to know the source location to handle moving
                                const editTask = this._editContext.task;
                                const sourceIsWorkspaceLevel = editTask ? (editTask as any)._isWorkspaceLevel : false;
                                const sourceFolder = sourceIsWorkspaceLevel 
                                    ? '__workspace__' 
                                    : (editTask ? (editTask as any)._workspaceFolder : undefined);
                                
                                await this._taskService.updateTask(
                                    this._editContext.originalLabel, 
                                    taskConfig, 
                                    targetFolder,
                                    sourceFolder
                                );
                            } else {
                                await this._taskService.saveTaskToWorkspace(taskConfig, targetFolder || undefined, saveToWorkspaceFile);
                            }
                            
                            // Notify callback if provided
                            if (this._editContext.onSaveComplete) {
                                this._editContext.onSaveComplete();
                            }
                            
                            // Close this panel after save
                            this.dispose();
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to save task: ${error}`);
                        }
                        break;
                    case 'cancel':
                        this.dispose();
                        break;
                    case 'selectBuildFile':
                        const files = await vscode.window.showOpenDialog({
                            canSelectFiles: true,
                            canSelectFolders: false,
                            canSelectMany: false,
                            filters: { 'Ant Build Files': ['xml'] },
                            title: 'Select Ant Build File'
                        });
                        if (files && files.length > 0) {
                            await this.updateBuildFile(files[0].fsPath);
                        }
                        break;
                    case 'browseDirectory':
                        const targetField = message.target;
                        let dialogTitle = 'Select Directory';
                        if (targetField === 'workingDirectory') {
                            dialogTitle = 'Select Working Directory';
                        } else if (targetField === 'antHome') {
                            dialogTitle = 'Select ANT_HOME Directory';
                        } else if (targetField === 'javaHome') {
                            dialogTitle = 'Select JAVA_HOME Directory';
                        }
                        const folders = await vscode.window.showOpenDialog({
                            canSelectFiles: false,
                            canSelectFolders: true,
                            canSelectMany: false,
                            title: dialogTitle
                        });
                        if (folders && folders.length > 0) {
                            this._panel.webview.postMessage({
                                command: 'setDirectory',
                                target: targetField,
                                path: folders[0].fsPath
                            });
                        }
                        break;
                    case 'refresh':
                        this._parserService.clearCache(this._buildFilePath);
                        // Show loading state while re-parsing
                        this._panel.webview.html = this._getLoadingHtml(this._panel.webview);
                        await this._update();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public async updateBuildFile(buildFilePath: string): Promise<void> {
        this._buildFilePath = buildFilePath;
        // Show loading state while parsing
        this._panel.webview.html = this._getLoadingHtml(this._panel.webview);
        await this._update();
    }

    private async _update(): Promise<void> {
        try {
            this._buildInfo = await this._parserService.parseBuildFile(this._buildFilePath);
            const title = this._editContext.isEditMode ? 'Edit Ant Task' : 'New Ant Task';
            this._panel.title = title;
            this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        } catch (error) {
            this._panel.webview.html = this._getErrorHtml(this._panel.webview, `${error}`);
            vscode.window.showErrorMessage(`Failed to parse build file: ${error}`);
        }
    }

    private _getLoadingHtml(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );
        const nonce = getNonce();
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Loading...</title>
</head>
<body>
    <div class="loading-container">
        <div class="spinner"></div>
        <p>Parsing build file...</p>
    </div>
</body>
</html>`;
    }

    private _getErrorHtml(webview: vscode.Webview, errorMessage: string): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );
        const nonce = getNonce();
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Error</title>
</head>
<body>
    <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h2>Failed to parse build file</h2>
        <p class="error-message">${escapeHtml(errorMessage)}</p>
    </div>
</body>
</html>`;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );

        const nonce = getNonce();
        const isEdit = this._editContext.isEditMode;
        const editTask = this._editContext.task;
        const selectedTargets = editTask?.targets || [];
        const additionalArgs = editTask?.additionalArgs || '';
        const taskName = isEdit && editTask ? editTask.label : `Ant: ${this._buildInfo?.projectName || 'build'}`;
        
        // Get workspace folders for the dropdown
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const defaultFolder = this._taskService.getWorkspaceFolderForFile(this._buildFilePath);
        const editTaskFolder = editTask ? (editTask as any)._workspaceFolder : undefined;
        const editIsWorkspaceLevel = editTask ? (editTask as any)._isWorkspaceLevel : false;
        const isMultiRootWorkspace = this._taskService.isMultiRootWorkspace();
        
        // Determine the selected folder name - use __workspace__ for workspace-level tasks
        let selectedFolderName: string;
        if (editIsWorkspaceLevel) {
            selectedFolderName = '__workspace__';
        } else {
            selectedFolderName = editTaskFolder?.name || defaultFolder?.name || (workspaceFolders[0]?.name || '');
        }
        
        // Get path-related defaults
        const defaultWorkingDir = path.dirname(this._buildFilePath);
        const workingDirectory = editTask?.workingDirectory || defaultWorkingDir;
        const antHome = editTask?.antHome || '';
        const javaHome = editTask?.javaHome || '';
        const shell = editTask?.shell || 'default';

        const buildInfo = this._buildInfo;
        // Build the targets list (compact checkboxes)
        const targetsHtml = buildInfo?.targets.map(target => {
            const isSelected = selectedTargets.includes(target.name) || (!isEdit && target.isDefault);
            const tooltip = [target.description, target.dependencies.length > 0 ? `Depends: ${target.dependencies.join(', ')}` : ''].filter(Boolean).join(' | ');
            return `
            <label class="target-compact" title="${escapeHtml(tooltip)}">
                <input type="checkbox" value="${escapeHtml(target.name)}" ${isSelected ? 'checked' : ''}>
                <span class="target-label">${target.isDefault ? '⭐' : ''}${escapeHtml(target.name)}</span>
            </label>
        `;}).join('') || '<p>No targets found</p>';

        // Pre-compute initial selected targets in order for edit mode
        const initialSelectedJson = JSON.stringify(selectedTargets);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>${isEdit ? 'Edit' : 'New'} Ant Task</title>
</head>
<body>
    <div class="container">
        <header>
            <h1>🐜 ${isEdit ? 'Edit' : 'New'} Ant Task</h1>
        </header>

        <section class="build-file-section">
            <h2>Build File</h2>
            <div class="build-file-row">
                <input type="text" id="buildFilePath" value="${escapeHtml(this._buildFilePath)}" readonly>
                <button id="browseBuildFile">Browse...</button>
                <button id="refreshBtn" title="Refresh">🔄</button>
            </div>
            ${buildInfo ? `
                <div class="project-info">
                    <span><strong>Project:</strong> ${escapeHtml(buildInfo.projectName || 'Unnamed')}</span>
                    <span><strong>Default Target:</strong> ${escapeHtml(buildInfo.defaultTarget || 'None')}</span>
                </div>
            ` : ''}
        </section>

        <section class="task-name-section">
            <h2>Task Configuration</h2>
            <div class="task-name-row">
                <label for="taskName">Task Name:</label>
                <input type="text" id="taskName" placeholder="e.g., Build Project" 
                       value="${escapeHtml(taskName)}">
            </div>
            ${workspaceFolders.length > 1 || isMultiRootWorkspace ? `
            <div class="task-name-row" style="margin-top: 12px;">
                <label for="workspaceFolder">Save to:</label>
                <select id="workspaceFolder">
                    ${workspaceFolders.map(folder => `
                        <option value="${escapeHtml(folder.name)}" ${folder.name === selectedFolderName ? 'selected' : ''}>
                            📁 ${escapeHtml(folder.name)}
                        </option>
                    `).join('')}
                    ${isMultiRootWorkspace ? `
                    <option value="__workspace__" ${selectedFolderName === '__workspace__' ? 'selected' : ''}>
                        🗂️ Workspace (shared)
                    </option>
                    ` : ''}
                </select>
            </div>
            ` : `<input type="hidden" id="workspaceFolder" value="${escapeHtml(selectedFolderName)}">`}
        </section>

        <section class="environment-section">
            <h2>Environment Settings</h2>
            <div class="env-row">
                <label for="workingDirectory">Working Directory:</label>
                <div class="input-with-browse">
                    <input type="text" id="workingDirectory" value="${escapeHtml(workingDirectory)}" placeholder="Working directory for Ant execution">
                    <button class="browse-btn" data-target="workingDirectory" title="Browse...">📁</button>
                </div>
            </div>
            <div class="env-row">
                <label for="antHome">ANT_HOME:</label>
                <div class="input-with-browse">
                    <input type="text" id="antHome" value="${escapeHtml(antHome)}" placeholder="Optional - required if Ant is not in PATH">
                    <button class="browse-btn" data-target="antHome" title="Browse...">📁</button>
                </div>
            </div>
            <div class="env-row">
                <label for="javaHome">JAVA_HOME:</label>
                <div class="input-with-browse">
                    <input type="text" id="javaHome" value="${escapeHtml(javaHome)}" placeholder="Optional - required if Java is not in PATH">
                    <button class="browse-btn" data-target="javaHome" title="Browse...">📁</button>
                </div>
            </div>
            <div class="env-row">
                <label for="shell">Terminal Shell:</label>
                <select id="shell">
                    <option value="default" ${shell === 'default' ? 'selected' : ''}>Default (System)</option>
                    <option value="powershell" ${shell === 'powershell' ? 'selected' : ''}>PowerShell</option>
                    <option value="cmd" ${shell === 'cmd' ? 'selected' : ''}>Command Prompt (cmd)</option>
                    <option value="bash" ${shell === 'bash' ? 'selected' : ''}>Bash</option>
                    <option value="sh" ${shell === 'sh' ? 'selected' : ''}>sh</option>
                    <option value="zsh" ${shell === 'zsh' ? 'selected' : ''}>Zsh</option>
                    <option value="wsl" ${shell === 'wsl' ? 'selected' : ''}>WSL Bash</option>
                </select>
            </div>
        </section>

        <section class="targets-section">
            <h2>Available Targets</h2>
            <p class="help-text">Check the targets you want to include in this task.</p>
            <div class="targets-list" id="targetsList">
                ${targetsHtml}
            </div>
        </section>

        <section class="selected-section">
            <h2>Execution Order</h2>
            <p class="help-text">Use the arrows to reorder selected targets. Targets will run from top to bottom.</p>
            <div id="selectedOrder" class="selected-order-list"></div>
        </section>

        <section class="arguments-section">
            <h2>Additional Arguments</h2>
            <p class="help-text">Enter additional Ant arguments (e.g., -Dproperty=value -verbose -debug). One argument per line or space-separated.</p>
            <textarea id="additionalArgs" rows="4" placeholder="-Dproperty=value
-verbose
-debug">${escapeHtml(additionalArgs)}</textarea>
        </section>

        <footer class="actions">
            <button id="cancelBtn">Cancel</button>
            <button id="saveTaskBtn" class="primary">💾 ${isEdit ? 'Update Task' : 'Save Task'}</button>
        </footer>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Track selected targets in order
        let selectedTargetsOrder = ${initialSelectedJson};

        // Render the selected targets list with reorder buttons
        function renderSelectedOrder() {
            const orderDiv = document.getElementById('selectedOrder');
            
            if (selectedTargetsOrder.length === 0) {
                orderDiv.innerHTML = '<div class="no-selection">No targets selected</div>';
                return;
            }
            
            orderDiv.innerHTML = selectedTargetsOrder.map((name, i) => 
                '<div class="selected-target-item" data-target="' + name + '">' +
                    '<span class="order-number">' + (i + 1) + '</span>' +
                    '<span class="order-name">' + name + '</span>' +
                    '<div class="order-buttons">' +
                        '<button class="order-btn order-up" title="Move Up" ' + (i === 0 ? 'disabled' : '') + '>▲</button>' +
                        '<button class="order-btn order-down" title="Move Down" ' + (i === selectedTargetsOrder.length - 1 ? 'disabled' : '') + '>▼</button>' +
                    '</div>' +
                '</div>'
            ).join('');
            
            // Attach event listeners to the new buttons
            orderDiv.querySelectorAll('.order-up').forEach((btn, idx) => {
                btn.addEventListener('click', () => moveTarget(idx, -1));
            });
            orderDiv.querySelectorAll('.order-down').forEach((btn, idx) => {
                btn.addEventListener('click', () => moveTarget(idx, 1));
            });
        }

        // Move a target up or down in the order
        function moveTarget(index, direction) {
            const newIndex = index + direction;
            if (newIndex < 0 || newIndex >= selectedTargetsOrder.length) return;
            
            const temp = selectedTargetsOrder[index];
            selectedTargetsOrder[index] = selectedTargetsOrder[newIndex];
            selectedTargetsOrder[newIndex] = temp;
            renderSelectedOrder();
        }

        // Handle checkbox changes - add/remove from selected order
        function handleCheckboxChange(e) {
            const targetName = e.target.value;
            if (e.target.checked) {
                // Add to end of selected list if not already there
                if (!selectedTargetsOrder.includes(targetName)) {
                    selectedTargetsOrder.push(targetName);
                }
            } else {
                // Remove from selected list
                selectedTargetsOrder = selectedTargetsOrder.filter(t => t !== targetName);
            }
            renderSelectedOrder();
        }

        // Initialize
        renderSelectedOrder();

        // Attach checkbox listeners
        document.querySelectorAll('.target-compact input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', handleCheckboxChange);
        });

        // Get selected targets in order
        function getSelectedTargets() {
            return selectedTargetsOrder;
        }

        // Get additional arguments
        function getAdditionalArgs() {
            return document.getElementById('additionalArgs').value.trim();
        }

        // Get environment settings
        function getEnvironmentSettings() {
            return {
                workingDirectory: document.getElementById('workingDirectory').value.trim(),
                antHome: document.getElementById('antHome').value.trim(),
                javaHome: document.getElementById('javaHome').value.trim(),
                shell: document.getElementById('shell').value
            };
        }

        // Cancel button
        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        // Save task button
        document.getElementById('saveTaskBtn').addEventListener('click', () => {
            const targets = getSelectedTargets();
            const taskName = document.getElementById('taskName').value.trim();
            if (targets.length === 0 || !taskName) {
                return;
            }
            const env = getEnvironmentSettings();
            const workspaceFolderName = document.getElementById('workspaceFolder').value;
            vscode.postMessage({ 
                command: 'saveTask', 
                targets, 
                taskName,
                additionalArgs: getAdditionalArgs(),
                workingDirectory: env.workingDirectory,
                antHome: env.antHome,
                javaHome: env.javaHome,
                shell: env.shell,
                workspaceFolderName: workspaceFolderName
            });
        });

        // Browse button for build file
        document.getElementById('browseBuildFile').addEventListener('click', () => {
            vscode.postMessage({ command: 'selectBuildFile' });
        });

        // Browse buttons for directories
        document.querySelectorAll('.browse-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget.getAttribute('data-target');
                vscode.postMessage({ command: 'browseDirectory', target });
            });
        });

        // Handle directory selection response
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'setDirectory') {
                const input = document.getElementById(message.target);
                if (input) {
                    input.value = message.path;
                }
            }
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });
    </script>
</body>
</html>`;
    }

    public dispose() {
        AntConfigurationPanel.currentPanel = undefined;

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
