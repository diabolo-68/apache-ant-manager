import * as vscode from 'vscode';
import * as path from 'path';
import { AntParserService } from '../services/AntParserService';
import { AntTaskService, AntTaskConfig } from '../services/AntTaskService';
import { AntBuildInfo } from '../types/antTypes';

/**
 * Form state to preserve user edits between re-renders.
 */
interface FormState {
    workingDirectory?: string;
    buildFilePath?: string;
    antHome?: string;
    javaHome?: string;
    shell?: string;
    taskName?: string;
    additionalArgs?: string;
    selectedTargets?: string[];
}

/**
 * Edit mode for the configuration panel.
 */
export interface EditContext {
    isEditMode: boolean;
    originalLabel?: string;
    originalWorkspaceFolder?: string;
    task?: AntTaskConfig;
    workspaceFolder?: string;
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
    private _formState: FormState = {};
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

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'saveTask':
                        try {
                            // Resolve the build file path
                            let resolvedBuildFile = this._taskService.resolveWorkspacePath(message.buildFilePath);
                            
                            // If it's still a relative path, resolve it against working directory
                            if (!path.isAbsolute(resolvedBuildFile) && !resolvedBuildFile.startsWith('${')) {
                                let workingDir = message.workingDirectory || '';
                                if (workingDir) {
                                    workingDir = this._taskService.resolveWorkspacePath(workingDir);
                                    resolvedBuildFile = path.resolve(workingDir, resolvedBuildFile);
                                }
                            }
                            
                            const taskConfig = this._taskService.generateTaskConfig(
                                resolvedBuildFile,
                                message.targets,
                                message.taskName,
                                message.additionalArgs || '',
                                message.workingDirectory,
                                message.antHome,
                                message.javaHome,
                                message.shell
                            );
                            
                            const targetWorkspaceFolder = message.workspaceFolder;
                            
                            if (this._editContext.isEditMode && this._editContext.originalLabel) {
                                // Check if workspace folder has changed
                                const originalWorkspace = this._editContext.originalWorkspaceFolder;
                                const workspaceChanged = originalWorkspace && targetWorkspaceFolder && 
                                    originalWorkspace !== targetWorkspaceFolder;
                                
                                if (workspaceChanged) {
                                    // Workspace changed: delete from old workspace, create in new
                                    try {
                                        await this._taskService.deleteTask(this._editContext.originalLabel, originalWorkspace);
                                    } catch (e) {
                                        // Ignore if task doesn't exist in old workspace
                                        console.warn(`Could not delete task from original workspace: ${e}`);
                                    }
                                    await this._taskService.saveTaskToWorkspace(taskConfig, targetWorkspaceFolder);
                                } else {
                                    // Same workspace: update in place
                                    await this._taskService.updateTask(this._editContext.originalLabel, taskConfig, targetWorkspaceFolder);
                                }
                            } else {
                                await this._taskService.saveTaskToWorkspace(taskConfig, targetWorkspaceFolder);
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
                        // Store form state before refresh
                        if (message.formState) {
                            this._formState = message.formState;
                        }
                        this._parserService.clearCache(this._buildFilePath);
                        await this._update();
                        break;
                    case 'workspaceFolderChanged':
                        // Update paths when workspace folder changes
                        if (message.formState) {
                            const oldBuildPath = message.formState.buildFilePath;
                            const oldWorkingDir = message.formState.workingDirectory;
                            const newFolderName = message.newWorkspaceFolder;
                            
                            // Get the new workspace folder
                            const workspaceFolders = this._taskService.getWorkspaceFolders();
                            const newFolder = workspaceFolders.find(f => f.name === newFolderName);
                            
                            if (!newFolder) {
                                vscode.window.showErrorMessage(`Workspace folder "${newFolderName}" not found`);
                                break;
                            }
                            
                            // Update build file path to use new workspace folder
                            if (oldBuildPath) {
                                if (oldBuildPath.includes('${workspaceFolder')) {
                                    // Replace old workspace folder reference with new one
                                    // Extract the relative part after ${workspaceFolder...}
                                    const relativePart = oldBuildPath.replace(/\$\{workspaceFolder(?::[^}]+)?\}[\/\\]?/, '');
                                    message.formState.buildFilePath = relativePart 
                                        ? `\${workspaceFolder:${newFolderName}}/${relativePart}`
                                        : `\${workspaceFolder:${newFolderName}}`;
                                } else if (path.isAbsolute(oldBuildPath)) {
                                    // Absolute path - try to make it relative to new workspace
                                    const newRelative = this._taskService.toWorkspaceRelativePath(oldBuildPath);
                                    if (newRelative.includes('${workspaceFolder')) {
                                        message.formState.buildFilePath = newRelative.replace(
                                            /\$\{workspaceFolder(?::[^}]+)?\}/,
                                            `\${workspaceFolder:${newFolderName}}`
                                        );
                                    } else {
                                        // Keep as-is if can't convert
                                        message.formState.buildFilePath = `\${workspaceFolder:${newFolderName}}/${path.basename(oldBuildPath)}`;
                                    }
                                } else {
                                    // Relative path without ${workspaceFolder} - prepend new workspace folder
                                    message.formState.buildFilePath = `\${workspaceFolder:${newFolderName}}/${oldBuildPath}`;
                                }
                            }
                            
                            // Also update working directory
                            if (oldWorkingDir) {
                                if (oldWorkingDir.includes('${workspaceFolder')) {
                                    const relativePart = oldWorkingDir.replace(/\$\{workspaceFolder(?::[^}]+)?\}[\/\\]?/, '');
                                    message.formState.workingDirectory = relativePart
                                        ? `\${workspaceFolder:${newFolderName}}/${relativePart}`
                                        : `\${workspaceFolder:${newFolderName}}`;
                                } else if (path.isAbsolute(oldWorkingDir)) {
                                    message.formState.workingDirectory = `\${workspaceFolder:${newFolderName}}`;
                                } else {
                                    // Relative path - prepend new workspace folder
                                    message.formState.workingDirectory = oldWorkingDir
                                        ? `\${workspaceFolder:${newFolderName}}/${oldWorkingDir}`
                                        : `\${workspaceFolder:${newFolderName}}`;
                                }
                            } else {
                                // Default to new workspace folder root
                                message.formState.workingDirectory = `\${workspaceFolder:${newFolderName}}`;
                            }
                            
                            this._formState = message.formState;
                            this._editContext.workspaceFolder = newFolderName;
                            
                            // Always resolve and re-parse when workspace changes
                            const resolvedBuildPath = this._taskService.resolveWorkspacePath(message.formState.buildFilePath);
                            this._buildFilePath = resolvedBuildPath;
                            this._parserService.clearCache();
                            await this._update();
                        }
                        break;
                    case 'updateBuildFilePath':
                        // Store form state before update
                        if (message.formState) {
                            this._formState = message.formState;
                        }
                        
                        // Resolve the build file path
                        let resolvedPath = message.path;
                        
                        // First try to resolve ${workspaceFolder} syntax
                        resolvedPath = this._taskService.resolveWorkspacePath(resolvedPath);
                        
                        // If it's still a relative path (not absolute and not starting with ${),
                        // resolve it relative to the working directory
                        if (!path.isAbsolute(resolvedPath) && !resolvedPath.startsWith('${')) {
                            let workingDir = message.workingDirectory || '';
                            if (workingDir) {
                                workingDir = this._taskService.resolveWorkspacePath(workingDir);
                                resolvedPath = path.resolve(workingDir, resolvedPath);
                            }
                        }
                        
                        if (resolvedPath !== this._buildFilePath) {
                            await this.updateBuildFile(resolvedPath);
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public async updateBuildFile(buildFilePath: string): Promise<void> {
        this._buildFilePath = buildFilePath;
        await this._update();
    }

    private async _update(): Promise<void> {
        // Show loading spinner immediately
        this._panel.webview.html = this._getLoadingHtml(this._panel.webview);
        
        try {
            this._buildInfo = await this._parserService.parseBuildFile(this._buildFilePath);
            const title = this._editContext.isEditMode ? 'Edit Ant Task' : 'New Ant Task';
            this._panel.title = title;
            this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to parse build file: ${error}`);
        }
    }

    private _getLoadingHtml(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'style.css')
        );
        const nonce = getNonce();
        const title = this._editContext.isEditMode ? 'Edit Ant Task' : 'New Ant Task';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>${title}</title>
    <style nonce="${nonce}">
        .loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 80vh;
            gap: 20px;
        }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid var(--vscode-editor-foreground);
            border-top-color: var(--vscode-button-background);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .loading-text {
            color: var(--vscode-foreground);
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🐜 ${title}</h1>
        </header>
        <div class="loading-container">
            <div class="spinner"></div>
            <div class="loading-text">Parsing Ant build file...</div>
        </div>
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
        
        // Use form state values if available (preserves user edits), otherwise use edit task or defaults
        const selectedTargets = this._formState.selectedTargets || editTask?.targets || [];
        const additionalArgs = this._formState.additionalArgs ?? editTask?.additionalArgs ?? '';
        const taskName = this._formState.taskName ?? (isEdit && editTask ? editTask.label : `Ant: ${this._buildInfo?.projectName || 'build'}`);
        
        // Get path-related defaults - convert to workspace-relative for display
        const defaultWorkingDir = path.dirname(this._buildFilePath);
        // Keep working directory as-is to preserve user's ${workspaceFolder} syntax
        // Only convert to workspace-relative if it's a new task with default working dir
        const workingDirectory = this._formState.workingDirectory ?? 
            editTask?.workingDirectory ?? 
            this._taskService.toWorkspaceRelativePath(defaultWorkingDir);
        const antHome = this._formState.antHome ?? editTask?.antHome ?? '';
        const javaHome = this._formState.javaHome ?? editTask?.javaHome ?? '';
        const shell = this._formState.shell ?? editTask?.shell ?? 'default';
        
        // Convert build file path to workspace-relative for display
        const displayBuildFilePath = this._formState.buildFilePath ?? this._taskService.toWorkspaceRelativePath(this._buildFilePath);
        
        // Multi-root workspace support
        const isMultiRoot = this._taskService.isMultiRootWorkspace();
        const workspaceFolders = this._taskService.getWorkspaceFolders();
        const currentWorkspaceFolder = this._editContext.workspaceFolder || 
            (workspaceFolders.length > 0 ? workspaceFolders[0].name : '');

        const buildInfo = this._buildInfo;
        const targetsHtml = buildInfo?.targets.map(target => {
            const isSelected = selectedTargets.includes(target.name) || (!isEdit && !this._formState.selectedTargets && target.isDefault);
            return `
            <div class="target-item" data-target="${escapeHtml(target.name)}">
                <div class="target-checkbox">
                    <input type="checkbox" id="target-${escapeHtml(target.name)}" 
                           value="${escapeHtml(target.name)}"
                           ${isSelected ? 'checked' : ''}>
                </div>
                <div class="target-info">
                    <label for="target-${escapeHtml(target.name)}" class="target-name">
                        ${target.isDefault ? '⭐ ' : ''}${escapeHtml(target.name)}
                    </label>
                    ${target.description ? `<span class="target-description">${escapeHtml(target.description)}</span>` : ''}
                    ${target.dependencies.length > 0 ? `<span class="target-depends">Depends: ${target.dependencies.map(escapeHtml).join(', ')}</span>` : ''}
                </div>
                <div class="target-order">
                    <button class="order-btn move-up" title="Move Up">▲</button>
                    <button class="order-btn move-down" title="Move Down">▼</button>
                </div>
            </div>
        `;}).join('') || '<p>No targets found</p>';

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

        ${isMultiRoot ? `
        <section class="workspace-section">
            <h2>Target Workspace</h2>
            <p class="help-text">Select which project's tasks.json file to save this task to.</p>
            <div class="env-row">
                <label for="workspaceFolder">Save to Project:</label>
                <select id="workspaceFolder">
                    ${workspaceFolders.map(f => 
                        `<option value="${escapeHtml(f.name)}" ${f.name === currentWorkspaceFolder ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
                    ).join('')}
                </select>
            </div>
        </section>
        ` : ''}

        <section class="working-dir-section">
            <h2>Working Directory</h2>
            <p class="help-text">Base directory for Ant execution. Relative build file paths will be resolved from here.</p>
            <div class="env-row">
                <label for="workingDirectory">Directory:</label>
                <div class="input-with-browse">
                    <input type="text" id="workingDirectory" value="${escapeHtml(workingDirectory)}" placeholder="Working directory for Ant execution">
                    <button class="browse-btn" data-target="workingDirectory" title="Browse...">📁</button>
                </div>
            </div>
        </section>

        <section class="build-file-section">
            <h2>Build File</h2>
            <p class="help-text">Path to build.xml. Can be absolute, workspace-relative (\${workspaceFolder}/...), or relative to working directory.</p>
            <div class="env-row">
                <label for="buildFilePath">File:</label>
                <div class="input-with-browse">
                    <input type="text" id="buildFilePath" value="${escapeHtml(displayBuildFilePath)}" 
                           placeholder="Path to build.xml">
                    <button id="browseBuildFile" class="browse-btn" title="Browse...">📁</button>
                    <button id="refreshBtn" class="browse-btn" title="Refresh">🔄</button>
                </div>
            </div>
            ${buildInfo ? `
                <div class="project-info">
                    <span><strong>Project:</strong> ${escapeHtml(buildInfo.projectName || 'Unnamed')}</span>
                    <span><strong>Default Target:</strong> ${escapeHtml(buildInfo.defaultTarget || 'None')}</span>
                </div>
            ` : ''}
        </section>

        <section class="environment-section">
            <h2>Environment Settings</h2>
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
            <h2>Targets</h2>
            <p class="help-text">Select targets to run and use arrows to define execution order.</p>
            <div class="targets-list" id="targetsList">
                ${targetsHtml}
            </div>
        </section>

        <section class="selected-section">
            <h2>Selected Targets Order</h2>
            <div id="selectedOrder" class="selected-order"></div>
        </section>

        <section class="arguments-section">
            <h2>Additional Arguments</h2>
            <p class="help-text">Enter additional Ant arguments (e.g., -Dproperty=value -verbose -debug). One argument per line or space-separated.</p>
            <textarea id="additionalArgs" rows="4" placeholder="-Dproperty=value
-verbose
-debug">${escapeHtml(additionalArgs)}</textarea>
        </section>

        <section class="task-name-section">
            <h2>Task Configuration</h2>
            <div class="task-name-row">
                <label for="taskName">Task Name:</label>
                <input type="text" id="taskName" placeholder="e.g., Build Project" 
                       value="${escapeHtml(taskName)}">
            </div>
        </section>

        <footer class="actions">
            <button id="cancelBtn">Cancel</button>
            <button id="saveTaskBtn" class="primary">💾 ${isEdit ? 'Update Task' : 'Save Task'}</button>
        </footer>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Update selected order display
        function updateSelectedOrder() {
            const checkboxes = document.querySelectorAll('.target-item input[type="checkbox"]:checked');
            const orderDiv = document.getElementById('selectedOrder');
            const names = Array.from(checkboxes).map(cb => cb.value);
            
            if (names.length === 0) {
                orderDiv.innerHTML = '<span class="no-selection">No targets selected</span>';
            } else {
                orderDiv.innerHTML = names.map((name, i) => 
                    '<span class="order-tag">' + (i + 1) + '. ' + name + '</span>'
                ).join(' → ');
            }
        }

        // Initialize
        updateSelectedOrder();

        // Handle checkbox changes
        document.querySelectorAll('.target-item input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', updateSelectedOrder);
        });

        // Handle move up/down buttons
        document.querySelectorAll('.move-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.target-item');
                const prev = item.previousElementSibling;
                if (prev) {
                    item.parentNode.insertBefore(item, prev);
                    updateSelectedOrder();
                }
            });
        });

        document.querySelectorAll('.move-down').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const item = e.target.closest('.target-item');
                const next = item.nextElementSibling;
                if (next) {
                    item.parentNode.insertBefore(next, item);
                    updateSelectedOrder();
                }
            });
        });

        // Get selected targets in order
        function getSelectedTargets() {
            const items = document.querySelectorAll('.target-item');
            const targets = [];
            items.forEach(item => {
                const cb = item.querySelector('input[type="checkbox"]');
                if (cb && cb.checked) {
                    targets.push(cb.value);
                }
            });
            return targets;
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
            const buildFilePath = document.getElementById('buildFilePath').value.trim();
            const workspaceFolderSelect = document.getElementById('workspaceFolder');
            const workspaceFolder = workspaceFolderSelect ? workspaceFolderSelect.value : undefined;
            
            vscode.postMessage({ 
                command: 'saveTask', 
                targets, 
                taskName,
                buildFilePath,
                workspaceFolder,
                additionalArgs: getAdditionalArgs(),
                workingDirectory: env.workingDirectory,
                antHome: env.antHome,
                javaHome: env.javaHome,
                shell: env.shell
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

        // Get current form state to preserve user edits during refresh
        function getFormState() {
            return {
                workingDirectory: document.getElementById('workingDirectory').value,
                buildFilePath: document.getElementById('buildFilePath').value,
                antHome: document.getElementById('antHome').value,
                javaHome: document.getElementById('javaHome').value,
                shell: document.getElementById('shell').value,
                taskName: document.getElementById('taskName').value,
                additionalArgs: document.getElementById('additionalArgs').value,
                selectedTargets: getSelectedTargets()
            };
        }

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh', formState: getFormState() });
        });

        // Workspace folder dropdown change handler (multi-root workspaces)
        const workspaceFolderSelect = document.getElementById('workspaceFolder');
        if (workspaceFolderSelect) {
            workspaceFolderSelect.addEventListener('change', (e) => {
                const newFolder = e.target.value;
                vscode.postMessage({ 
                    command: 'workspaceFolderChanged', 
                    newWorkspaceFolder: newFolder,
                    formState: getFormState() 
                });
            });
        }

        // Build file path change handler - reparse on blur or Enter
        const buildFileInput = document.getElementById('buildFilePath');
        let lastBuildFilePath = buildFileInput.value;
        
        buildFileInput.addEventListener('blur', () => {
            const newPath = buildFileInput.value.trim();
            if (newPath && newPath !== lastBuildFilePath) {
                lastBuildFilePath = newPath;
                const workingDir = document.getElementById('workingDirectory').value.trim();
                vscode.postMessage({ 
                    command: 'updateBuildFilePath', 
                    path: newPath, 
                    workingDirectory: workingDir,
                    formState: getFormState()
                });
            }
        });
        
        buildFileInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                buildFileInput.blur();
            }
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
