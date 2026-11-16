import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AntParserService } from '../services/AntParserService';
import { AntTaskService, AntTaskConfig } from '../services/AntTaskService';
import { AntBuildInfo } from '../types/antTypes';
import { errorPage, escapeHtml, icon, loadingPage, renderPage } from './webviewUtils';

/**
 * Edit mode for the configuration panel.
 */
export interface EditContext {
    isEditMode: boolean;
    originalLabel?: string;
    task?: AntTaskConfig;
    onSaveComplete?: () => void;
}

/** Form values as last seen in the webview; kept when the build file changes. */
interface Draft {
    taskName: string;
    workspaceFolderName: string;
    targets: string[];
    additionalArgs: string;
    workingDirectory: string;
    antHome: string;
    javaHome: string;
    shell: string;
}

const WORKSPACE_SCOPE = '__workspace__';

/**
 * Webview panel for creating or editing an Ant task.
 */
export class AntConfigurationPanel {
    public static currentPanel: AntConfigurationPanel | undefined;
    public static readonly viewType = 'antConfiguration';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _parserService: AntParserService;
    private readonly _taskService: AntTaskService;
    private _buildFilePath: string;
    private _rawBuildFilePath: string;
    private _buildInfo: AntBuildInfo | undefined;
    private _editContext: EditContext;
    private _draft: Draft | undefined;
    private _dirty = false;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        parserService: AntParserService,
        taskService: AntTaskService,
        buildFilePath: string,
        editContext?: EditContext
    ) {
        const column = vscode.window.activeTextEditor?.viewColumn;
        const ctx = editContext || { isEditMode: false };

        if (AntConfigurationPanel.currentPanel) {
            const current = AntConfigurationPanel.currentPanel;
            current._panel.reveal(column);
            current._editContext = ctx;
            current._draft = undefined;
            current._setDirty(false);
            current.updateBuildFile(buildFilePath);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            AntConfigurationPanel.viewType,
            ctx.isEditMode ? 'Edit Ant Task' : 'New Ant Task',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');

        AntConfigurationPanel.currentPanel = new AntConfigurationPanel(
            panel, extensionUri, parserService, taskService, buildFilePath, ctx
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
        this._rawBuildFilePath = buildFilePath;
        this._buildFilePath = this._taskService.resolveWorkspacePath(buildFilePath);
        this._editContext = editContext;

        this._panel.webview.html = loadingPage(panel.webview, extensionUri, 'Parsing build file…');
        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(async (message) => {
            if (message.draft) {
                this._draft = message.draft;
            }
            switch (message.command) {
                case 'saveTask':
                    await this._save(message.draft as Draft, !!message.run);
                    break;
                case 'cancel':
                    if (this._dirty) {
                        const choice = await vscode.window.showWarningMessage(
                            'Discard unsaved changes to this task?', { modal: true }, 'Discard'
                        );
                        if (choice !== 'Discard') { return; }
                    }
                    this.dispose();
                    break;
                case 'dirty':
                    this._setDirty(!!message.dirty);
                    break;
                case 'selectBuildFile': {
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
                }
                case 'updateBuildFilePath': {
                    const manualPath = message.path;
                    if (manualPath && manualPath !== this._rawBuildFilePath) {
                        const resolvedPath = this._taskService.resolveWorkspacePath(manualPath);
                        if (fs.existsSync(resolvedPath)) {
                            await this.updateBuildFile(manualPath);
                        } else {
                            this._panel.webview.postMessage({ command: 'buildFileError', message: `File not found: ${resolvedPath}` });
                        }
                    }
                    break;
                }
                case 'browseDirectory': {
                    const titles: Record<string, string> = {
                        workingDirectory: 'Select Working Directory',
                        antHome: 'Select ANT_HOME Directory',
                        javaHome: 'Select JAVA_HOME Directory'
                    };
                    const folders = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        title: titles[message.target] ?? 'Select Directory'
                    });
                    if (folders && folders.length > 0) {
                        this._panel.webview.postMessage({ command: 'setDirectory', target: message.target, path: folders[0].fsPath });
                    }
                    break;
                }
                case 'refresh':
                    this._parserService.clearCache(this._buildFilePath);
                    this._panel.webview.html = loadingPage(this._panel.webview, this._extensionUri, 'Parsing build file…');
                    await this._update();
                    break;
            }
        }, null, this._disposables);
    }

    private _baseTitle(): string {
        return this._editContext.isEditMode ? `Edit: ${this._editContext.originalLabel ?? 'Ant Task'}` : 'New Ant Task';
    }

    private _setDirty(dirty: boolean): void {
        this._dirty = dirty;
        this._panel.title = (dirty ? '● ' : '') + this._baseTitle();
    }

    private async _save(draft: Draft, runAfterSave: boolean): Promise<void> {
        try {
            const taskConfig = this._taskService.generateTaskConfig(
                this._rawBuildFilePath,
                draft.targets,
                draft.taskName,
                draft.additionalArgs || '',
                draft.workingDirectory,
                draft.antHome,
                draft.javaHome,
                draft.shell
            );

            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            const saveToWorkspaceFile = draft.workspaceFolderName === WORKSPACE_SCOPE;
            const targetFolder = saveToWorkspaceFile
                ? null
                : workspaceFolders.find(f => f.name === draft.workspaceFolderName);

            if (this._editContext.isEditMode && this._editContext.originalLabel) {
                const editTask = this._editContext.task as any;
                const sourceFolder = editTask?._isWorkspaceLevel ? WORKSPACE_SCOPE : editTask?._workspaceFolder;
                await this._taskService.updateTask(this._editContext.originalLabel, taskConfig, targetFolder, sourceFolder);
            } else {
                await this._taskService.saveTaskToWorkspace(taskConfig, targetFolder || undefined, saveToWorkspaceFile);
            }

            this._editContext.onSaveComplete?.();

            if (runAfterSave) {
                // Run directly rather than via tasks.json, which VS Code may not have reloaded yet.
                await this._taskService.runAntTargets(
                    this._buildFilePath,
                    draft.targets,
                    draft.additionalArgs,
                    draft.workingDirectory || undefined,
                    draft.antHome || undefined,
                    draft.javaHome || undefined,
                    draft.shell
                );
            }

            this._dirty = false;
            this.dispose();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save task: ${error}`);
            this._panel.webview.postMessage({ command: 'saveFailed' });
        }
    }

    public async updateBuildFile(buildFilePath: string): Promise<void> {
        this._rawBuildFilePath = buildFilePath;
        this._buildFilePath = this._taskService.resolveWorkspacePath(buildFilePath);
        this._panel.webview.html = loadingPage(this._panel.webview, this._extensionUri, 'Parsing build file…');
        await this._update();
    }

    private async _update(): Promise<void> {
        try {
            this._buildInfo = await this._parserService.parseBuildFile(this._buildFilePath);
            this._panel.title = (this._dirty ? '● ' : '') + this._baseTitle();
            this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
        } catch (error) {
            this._panel.webview.html = errorPage(
                this._panel.webview,
                this._extensionUri,
                'Could not parse the build file',
                `${this._buildFilePath}\n\n${error}`,
                [
                    { command: 'refresh', label: 'Try again', primary: true },
                    { command: 'selectBuildFile', label: 'Choose another build file…' }
                ]
            );
        }
    }

    /** Initial form values: draft (if the build file was switched) > task being edited > defaults. */
    private _initialValues(): Draft {
        const isEdit = this._editContext.isEditMode;
        const editTask = this._editContext.task as any;
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const defaultFolder = this._taskService.getWorkspaceFolderForFile(this._buildFilePath);

        let folderName: string;
        if (editTask?._isWorkspaceLevel) {
            folderName = WORKSPACE_SCOPE;
        } else {
            folderName = editTask?._workspaceFolder?.name || defaultFolder?.name || workspaceFolders[0]?.name || '';
        }

        const defaults: Draft = {
            taskName: isEdit && editTask ? editTask.label : `Ant: ${this._buildInfo?.projectName || path.basename(this._buildFilePath, '.xml')}`,
            workspaceFolderName: folderName,
            targets: isEdit
                ? (editTask?.targets || [])
                : (this._buildInfo?.defaultTarget ? [this._buildInfo.defaultTarget] : []),
            additionalArgs: editTask?.additionalArgs || '',
            workingDirectory: editTask?.workingDirectory || path.dirname(this._buildFilePath),
            antHome: editTask?.antHome || '',
            javaHome: editTask?.javaHome || '',
            shell: editTask?.shell || 'default'
        };
        if (!this._draft) { return defaults; }
        // After switching build files the old working directory default no longer applies.
        return { ...this._draft, workingDirectory: this._draft.workingDirectory || defaults.workingDirectory };
    }

    /** Labels already taken, per location, excluding the task being edited. */
    private _takenLabels(): Record<string, string[]> {
        const editTask = this._editContext.task as any;
        const editScope = editTask?._isWorkspaceLevel ? WORKSPACE_SCOPE : editTask?._workspaceFolderName;
        const result: Record<string, string[]> = {};
        for (const t of this._taskService.getManagedTasks() as any[]) {
            const scope = t._isWorkspaceLevel ? WORKSPACE_SCOPE : t._workspaceFolderName;
            if (this._editContext.isEditMode && t.label === this._editContext.originalLabel && scope === editScope) {
                continue;
            }
            (result[scope] ??= []).push(t.label);
        }
        return result;
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const isEdit = this._editContext.isEditMode;
        const values = this._initialValues();
        const buildInfo = this._buildInfo;

        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const isMultiRootWorkspace = this._taskService.isMultiRootWorkspace();
        const showFolderPicker = workspaceFolders.length > 1 || isMultiRootWorkspace;

        const config = vscode.workspace.getConfiguration('apacheAntManager');
        const settingsAntHome = config.get<string>('antHome') || '';
        const settingsJavaHome = config.get<string>('javaHome') || '';

        const defaultWorkingDir = path.dirname(this._buildFilePath);
        const envCustomised = (values.workingDirectory && values.workingDirectory !== defaultWorkingDir)
            || values.antHome || values.javaHome || values.shell !== 'default';

        const shells: [string, string][] = [
            ['default', 'Default (system)'], ['powershell', 'PowerShell'], ['cmd', 'Command Prompt (cmd)'],
            ['bash', 'Bash'], ['sh', 'sh'], ['zsh', 'Zsh'], ['wsl', 'WSL Bash']
        ];

        const init = {
            values,
            targets: buildInfo?.targets ?? [],
            takenLabels: this._takenLabels(),
            buildFile: this._rawBuildFilePath,
            isWindows: process.platform === 'win32',
            isEdit
        };
        const initJson = JSON.stringify(init).replace(/</g, '\\u003c');

        const metaParts: string[] = [];
        if (buildInfo?.projectName) { metaParts.push(`<span><strong>Project</strong> ${escapeHtml(buildInfo.projectName)}</span>`); }
        if (buildInfo?.defaultTarget) { metaParts.push(`<span><strong>Default target</strong> ${escapeHtml(buildInfo.defaultTarget)}</span>`); }
        metaParts.push(`<span>${buildInfo?.targets.length ?? 0} targets</span>`);

        const browseBtn = (target: string, label: string) =>
            `<button class="icon-btn" data-browse="${target}" title="Browse…" aria-label="Browse for ${label}">${icon('folder-opened')}</button>`;

        const body = `
<div class="container">
    <header class="page-header">
        <h1>${icon('tools')} ${isEdit ? 'Edit Ant Task' : 'New Ant Task'}</h1>
    </header>

    <section class="card">
        <h2>Build file</h2>
        <div class="input-group">
            <input type="text" id="buildFilePath" value="${escapeHtml(this._rawBuildFilePath)}" aria-label="Build file path" spellcheck="false">
            <button class="secondary" id="browseBuildFile">Browse…</button>
            <button class="icon-btn" id="refreshBtn" title="Re-parse build file" aria-label="Re-parse build file">${icon('refresh')}</button>
        </div>
        <div class="field-error" id="buildFileError" hidden></div>
        ${buildInfo?.description ? `<p class="help-text" style="margin:8px 0 0">${escapeHtml(buildInfo.description)}</p>` : ''}
        <div class="meta">${metaParts.join('')}</div>
    </section>

    <section class="card">
        <h2>Task</h2>
        <div class="form-grid">
            <label for="taskName">Name</label>
            <input type="text" id="taskName" placeholder="e.g. Build project" value="${escapeHtml(values.taskName)}">
            <div class="field-error" id="taskNameError" hidden></div>
            ${showFolderPicker ? `
            <label for="workspaceFolder">Save to</label>
            <select id="workspaceFolder">
                ${workspaceFolders.map(folder => `
                    <option value="${escapeHtml(folder.name)}" ${folder.name === values.workspaceFolderName ? 'selected' : ''}>${escapeHtml(folder.name)} — .vscode/tasks.json</option>
                `).join('')}
                ${isMultiRootWorkspace ? `
                    <option value="${WORKSPACE_SCOPE}" ${values.workspaceFolderName === WORKSPACE_SCOPE ? 'selected' : ''}>Workspace (shared) — .code-workspace</option>
                ` : ''}
            </select>` : `<input type="hidden" id="workspaceFolder" value="${escapeHtml(values.workspaceFolderName)}">`}
        </div>
    </section>

    <section class="card">
        <div class="section-head">
            <h2>Targets</h2>
            <span class="badge" id="selectedCount"></span>
        </div>
        <p class="help-text">Tick the targets to run. Selected targets run top to bottom — drag them, or use <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>, to change the order.</p>
        ${(buildInfo?.targets.length ?? 0) > 8 ? `
        <div class="target-filter">
            ${icon('search')}
            <input type="text" id="targetFilter" placeholder="Filter targets" aria-label="Filter targets">
        </div>` : ''}
        <div class="target-list" id="targetList" role="list"></div>
        <div class="field-error" id="targetsError" hidden style="margin-top:6px"></div>
    </section>

    <section class="card">
        <h2>Arguments</h2>
        <div class="subheading">Properties <span class="help-text">(-Dname=value)</span></div>
        <div class="prop-list" id="propList"></div>
        <button class="inline-link" id="addProp">${icon('add')} Add property</button>

        <div class="subheading">Options</div>
        <div class="check-row">
            <label title="Print more information"><input type="checkbox" data-flag="-verbose"><code>-verbose</code></label>
            <label title="Print debugging information"><input type="checkbox" data-flag="-debug"><code>-debug</code></label>
            <label title="Be extra quiet"><input type="checkbox" data-flag="-quiet"><code>-quiet</code></label>
            <label title="Execute all targets that do not depend on failed target(s)"><input type="checkbox" data-flag="-keep-going"><code>-keep-going</code></label>
            <label title="Produce logging information without adornments"><input type="checkbox" data-flag="-emacs"><code>-emacs</code></label>
        </div>

        <div class="subheading">Other arguments</div>
        <textarea id="otherArgs" rows="2" spellcheck="false" placeholder="Any other Ant command-line options" aria-label="Other arguments"></textarea>
    </section>

    <details class="card" id="envSection" ${envCustomised ? 'open' : ''}>
        <summary>Environment <span class="summary-hint" id="envSummary"></span></summary>
        <div class="form-grid">
            <label for="workingDirectory">Working directory</label>
            <div class="input-group">
                <input type="text" id="workingDirectory" value="${escapeHtml(values.workingDirectory)}" placeholder="${escapeHtml(defaultWorkingDir)}" spellcheck="false">
                ${browseBtn('workingDirectory', 'working directory')}
            </div>

            <label for="antHome">ANT_HOME</label>
            <div class="input-group">
                <input type="text" id="antHome" value="${escapeHtml(values.antHome)}" placeholder="Use ant from PATH" spellcheck="false">
                ${browseBtn('antHome', 'ANT_HOME')}
            </div>
            ${settingsAntHome ? `<div class="hint">Settings: <button class="inline-link" data-use="antHome" data-value="${escapeHtml(settingsAntHome)}">use ${escapeHtml(settingsAntHome)}</button></div>` : ''}

            <label for="javaHome">JAVA_HOME</label>
            <div class="input-group">
                <input type="text" id="javaHome" value="${escapeHtml(values.javaHome)}" placeholder="Use java from PATH" spellcheck="false">
                ${browseBtn('javaHome', 'JAVA_HOME')}
            </div>
            ${settingsJavaHome ? `<div class="hint">Settings: <button class="inline-link" data-use="javaHome" data-value="${escapeHtml(settingsJavaHome)}">use ${escapeHtml(settingsJavaHome)}</button></div>` : ''}

            <label for="shell">Terminal shell</label>
            <select id="shell">
                ${shells.map(([v, l]) => `<option value="${v}" ${values.shell === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
        </div>
    </details>

    <section class="card">
        <h2>Command preview</h2>
        <pre class="command-preview" id="commandPreview"></pre>
    </section>

    <footer class="action-bar">
        <span class="status" id="status" aria-live="polite"></span>
        <button class="secondary" id="cancelBtn">Cancel</button>
        <button class="secondary" id="saveRunBtn" title="Save the task and run it now">${icon('play')} Save &amp; Run</button>
        <button class="primary" id="saveTaskBtn" title="Save (Ctrl+S)">${icon('save')} ${isEdit ? 'Update Task' : 'Save Task'}</button>
    </footer>
</div>`;

        return renderPage(webview, this._extensionUri, {
            title: isEdit ? 'Edit Ant Task' : 'New Ant Task',
            body,
            script: `const INIT = ${initJson};\n${EDITOR_SCRIPT}`
        });
    }

    public dispose() {
        AntConfigurationPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}

/** Client-side logic for the editor webview. Reads the INIT object. */
const EDITOR_SCRIPT = String.raw`
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const FLAGS = ['-verbose', '-debug', '-quiet', '-keep-going', '-emacs'];

const targetsByName = new Map(INIT.targets.map(t => [t.name, t]));
let selected = [...INIT.values.targets];
let filter = '';
let attemptedSave = false;
const touched = new Set();

// ---------- Arguments: split stored string into properties / flags / other ----------
function tokenize(str) {
    const out = [];
    for (const line of String(str || '').split(/[\r\n]+/)) {
        const m = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
        if (m) { out.push(...m); }
    }
    return out;
}

let props = [];
(function initArgs() {
    const other = [];
    for (const tok of tokenize(INIT.values.additionalArgs)) {
        const m = tok.match(/^-D([^=]+)=(.*)$/);
        if (m) { props.push({ key: m[1], value: m[2] }); continue; }
        const flag = tok === '-v' ? '-verbose' : tok === '-d' ? '-debug' : tok === '-q' ? '-quiet' : tok === '-k' ? '-keep-going' : tok;
        const box = document.querySelector('[data-flag="' + CSS.escape(flag) + '"]');
        if (box) { box.checked = true; continue; }
        other.push(tok);
    }
    $('otherArgs').value = other.join('\n');
})();

function renderProps() {
    const list = $('propList');
    list.innerHTML = props.map((p, i) =>
        '<div class="prop-row" data-i="' + i + '">' +
            '<input type="text" class="prop-key" placeholder="name" value="' + esc(p.key) + '" aria-label="Property name" spellcheck="false">' +
            '<span class="eq">=</span>' +
            '<input type="text" class="prop-value" placeholder="value" value="' + esc(p.value) + '" aria-label="Property value" spellcheck="false">' +
            '<button class="icon-btn danger prop-remove" title="Remove property" aria-label="Remove property"><i class="codicon codicon-close"></i></button>' +
        '</div>').join('');
}

$('propList').addEventListener('input', (e) => {
    const row = e.target.closest('.prop-row');
    if (!row) { return; }
    const p = props[+row.dataset.i];
    if (e.target.classList.contains('prop-key')) { p.key = e.target.value.trim(); } else { p.value = e.target.value; }
    onChange();
});
$('propList').addEventListener('click', (e) => {
    const btn = e.target.closest('.prop-remove');
    if (!btn) { return; }
    props.splice(+btn.closest('.prop-row').dataset.i, 1);
    renderProps();
    onChange();
});
$('addProp').addEventListener('click', () => {
    props.push({ key: '', value: '' });
    renderProps();
    const keys = document.querySelectorAll('.prop-key');
    keys[keys.length - 1].focus();
});

function quoteIfNeeded(v) { return /\s/.test(v) && !/^["'].*["']$/.test(v) ? '"' + v + '"' : v; }

function collectArgs() {
    const lines = [];
    for (const p of props) { if (p.key) { lines.push('-D' + p.key + '=' + quoteIfNeeded(p.value)); } }
    document.querySelectorAll('[data-flag]').forEach(b => { if (b.checked) { lines.push(b.dataset.flag); } });
    const other = $('otherArgs').value.trim();
    if (other) { lines.push(other); }
    return lines.join('\n');
}

// ---------- Targets ----------
function targetRow(name, isSelected, order) {
    const t = targetsByName.get(name) || { name, description: null, dependencies: [], isDefault: false, missing: true };
    const lead = isSelected
        ? '<span class="order-number">' + (order + 1) + '</span>'
        : '<span></span>';
    let sub = '';
    if (t.missing) { sub += '<div class="target-desc" style="color:var(--error)"><i class="codicon codicon-warning"></i> Not found in this build file</div>'; }
    if (t.description) { sub += '<div class="target-desc">' + esc(t.description) + '</div>'; }
    if (t.dependencies && t.dependencies.length) {
        sub += '<div class="target-deps"><i class="codicon codicon-arrow-small-right"></i> depends on ' + t.dependencies.map(esc).join(', ') + '</div>';
    }
    const actions = isSelected
        ? '<div class="order-actions">' +
            '<button class="icon-btn move" data-dir="-1" title="Move up (Alt+↑)" aria-label="Move up"' + (order === 0 ? ' disabled' : '') + '><i class="codicon codicon-arrow-up"></i></button>' +
            '<button class="icon-btn move" data-dir="1" title="Move down (Alt+↓)" aria-label="Move down"' + (order === selected.length - 1 ? ' disabled' : '') + '><i class="codicon codicon-arrow-down"></i></button>' +
          '</div>'
        : '<span></span>';
    return '<div class="target-row' + (isSelected ? ' selected' : '') + '" role="listitem" tabindex="0" data-name="' + esc(name) + '"' +
        (isSelected ? ' draggable="true"' : '') + '>' +
        '<input type="checkbox" tabindex="-1" ' + (isSelected ? 'checked' : '') + ' aria-label="Include ' + esc(name) + '">' +
        lead +
        '<div class="target-main"><div class="target-title"><span class="target-name">' + esc(name) + '</span>' +
            (t.isDefault ? '<span class="badge outline">default</span>' : '') + '</div>' + sub + '</div>' +
        actions +
    '</div>';
}

function matches(name) {
    if (!filter) { return true; }
    const t = targetsByName.get(name);
    const hay = (name + ' ' + (t && t.description || '')).toLowerCase();
    return hay.includes(filter);
}

function renderTargets(focusName) {
    const list = $('targetList');
    const unselected = INIT.targets.map(t => t.name).filter(n => !selected.includes(n) && matches(n));
    const sel = selected.filter(matches);
    let html = '';
    if (INIT.targets.length === 0 && selected.length === 0) {
        html = '<div class="empty-row">This build file has no targets.</div>';
    } else {
        if (sel.length) {
            html += '<div class="target-group-label">Run order</div>' + sel.map(n => targetRow(n, true, selected.indexOf(n))).join('');
        }
        if (unselected.length) {
            html += '<div class="target-group-label">Available</div>' + unselected.map(n => targetRow(n, false, -1)).join('');
        }
        if (!sel.length && !unselected.length) {
            html = '<div class="empty-row">No targets match “' + esc(filter) + '”.</div>';
        }
    }
    list.innerHTML = html;
    $('selectedCount').textContent = selected.length + ' selected';
    if (focusName) {
        const row = list.querySelector('.target-row[data-name="' + CSS.escape(focusName) + '"]');
        if (row) { row.focus(); }
    }
}

function toggle(name) {
    if (selected.includes(name)) { selected = selected.filter(n => n !== name); }
    else { selected.push(name); }
    touched.add('targets');
    renderTargets(name);
    onChange();
}

function move(name, dir) {
    const i = selected.indexOf(name);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= selected.length) { return; }
    [selected[i], selected[j]] = [selected[j], selected[i]];
    renderTargets(name);
    onChange();
}

$('targetList').addEventListener('click', (e) => {
    const row = e.target.closest('.target-row');
    if (!row) { return; }
    const mv = e.target.closest('.move');
    if (mv) { move(row.dataset.name, +mv.dataset.dir); return; }
    toggle(row.dataset.name);
});

$('targetList').addEventListener('keydown', (e) => {
    const row = e.target.closest('.target-row');
    if (!row || e.target !== row) { return; }
    const name = row.dataset.name;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(name); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(name, e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const rows = [...document.querySelectorAll('.target-row')];
        const next = rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) { next.focus(); }
    }
});

// Drag and drop within the "Run order" group
let dragName = null;
$('targetList').addEventListener('dragstart', (e) => {
    const row = e.target.closest('.target-row.selected');
    if (!row) { return; }
    dragName = row.dataset.name;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragName);
});
$('targetList').addEventListener('dragover', (e) => {
    const row = e.target.closest('.target-row.selected');
    if (!dragName || !row) { return; }
    e.preventDefault();
    document.querySelectorAll('.drop-before,.drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'));
    const rect = row.getBoundingClientRect();
    row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
});
$('targetList').addEventListener('drop', (e) => {
    const row = e.target.closest('.target-row.selected');
    if (!dragName || !row) { return; }
    e.preventDefault();
    const before = row.classList.contains('drop-before');
    const targetName = row.dataset.name;
    if (targetName !== dragName) {
        selected = selected.filter(n => n !== dragName);
        const idx = selected.indexOf(targetName) + (before ? 0 : 1);
        selected.splice(idx, 0, dragName);
    }
    dragName = null;
    renderTargets();
    onChange();
});
$('targetList').addEventListener('dragend', () => {
    dragName = null;
    document.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(r => r.classList.remove('dragging', 'drop-before', 'drop-after'));
});

if ($('targetFilter')) {
    $('targetFilter').addEventListener('input', (e) => { filter = e.target.value.trim().toLowerCase(); renderTargets(); });
}

// ---------- Draft, validation, preview ----------
function draft() {
    return {
        taskName: $('taskName').value.trim(),
        workspaceFolderName: $('workspaceFolder').value,
        targets: [...selected],
        additionalArgs: collectArgs(),
        workingDirectory: $('workingDirectory').value.trim(),
        antHome: $('antHome').value.trim(),
        javaHome: $('javaHome').value.trim(),
        shell: $('shell').value
    };
}

function validate(d) {
    const errors = {};
    if (!d.taskName) { errors.taskName = 'Enter a name for the task.'; }
    else if ((INIT.takenLabels[d.workspaceFolderName] || []).includes(d.taskName)) {
        errors.taskName = 'A task with this name already exists in this location.';
    }
    if (d.targets.length === 0) { errors.targets = 'Select at least one target.'; }
    return errors;
}

function showError(id, inputEl, msg, visible) {
    const el = $(id);
    el.hidden = !(msg && visible);
    el.innerHTML = msg ? '<i class="codicon codicon-error"></i> ' + esc(msg) : '';
    if (inputEl) { inputEl.classList.toggle('invalid', !!(msg && visible)); }
}

function shellQuote(s) { return /[\s"]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s; }

function renderPreview(d) {
    const sep = INIT.isWindows ? '\\' : '/';
    const ant = d.antHome ? d.antHome.replace(/[\\/]+$/, '') + sep + 'bin' + sep + 'ant' : 'ant';
    const parts = [shellQuote(ant), '-f', shellQuote(INIT.buildFile)];
    parts.push(...tokenize(d.additionalArgs));
    parts.push(...d.targets);
    let text = parts.join(' ');
    if (d.workingDirectory) { text = '# in ' + d.workingDirectory + '\n' + text; }
    $('commandPreview').textContent = text;

    const env = [];
    if (d.antHome) { env.push('ANT_HOME'); }
    if (d.javaHome) { env.push('JAVA_HOME'); }
    if (d.shell !== 'default') { env.push($('shell').selectedOptions[0].textContent); }
    $('envSummary').textContent = env.length ? '— ' + env.join(', ') : '';
}

const initialSnapshot = JSON.stringify(draft());
let lastDirty = false;

function onChange() {
    const d = draft();
    const errors = validate(d);
    const showAll = attemptedSave;
    showError('taskNameError', $('taskName'), errors.taskName, showAll || touched.has('taskName'));
    showError('targetsError', $('targetList'), errors.targets, showAll || touched.has('targets'));

    const dirty = JSON.stringify(d) !== initialSnapshot;
    if (dirty !== lastDirty) { lastDirty = dirty; vscode.postMessage({ command: 'dirty', dirty }); }

    const status = $('status');
    const errorList = Object.values(errors);
    if (showAll && errorList.length) {
        status.textContent = errorList.join(' ');
        status.classList.add('error');
    } else {
        status.textContent = dirty ? 'Unsaved changes' : '';
        status.classList.remove('error');
    }
    renderPreview(d);
    vscode.setState({ draft: d });
    return errors;
}

// ---------- Save / cancel ----------
let saving = false;
function save(run) {
    if (saving) { return; }
    attemptedSave = true;
    const errors = onChange();
    if (errors.taskName) { $('taskName').focus(); return; }
    if (errors.targets) { const first = document.querySelector('.target-row'); if (first) { first.focus(); } return; }
    saving = true;
    $('saveTaskBtn').disabled = $('saveRunBtn').disabled = true;
    $('status').textContent = 'Saving…';
    vscode.postMessage({ command: 'saveTask', draft: draft(), run });
}

$('saveTaskBtn').addEventListener('click', () => save(false));
$('saveRunBtn').addEventListener('click', () => save(true));
$('cancelBtn').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(true); }
});

// ---------- Build file & environment ----------
$('browseBuildFile').addEventListener('click', () => vscode.postMessage({ command: 'selectBuildFile', draft: draft() }));
$('refreshBtn').addEventListener('click', () => vscode.postMessage({ command: 'refresh', draft: draft() }));

const buildFileInput = $('buildFilePath');
const submitBuildFile = () => {
    const value = buildFileInput.value.trim();
    if (value && value !== INIT.buildFile) {
        vscode.postMessage({ command: 'updateBuildFilePath', path: value, draft: draft() });
    }
};
buildFileInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitBuildFile(); } });
buildFileInput.addEventListener('change', submitBuildFile);
buildFileInput.addEventListener('input', () => { $('buildFileError').hidden = true; buildFileInput.classList.remove('invalid'); });

document.querySelectorAll('[data-browse]').forEach(btn =>
    btn.addEventListener('click', () => vscode.postMessage({ command: 'browseDirectory', target: btn.dataset.browse })));
document.querySelectorAll('[data-use]').forEach(btn =>
    btn.addEventListener('click', () => { $(btn.dataset.use).value = btn.dataset.value; onChange(); }));

window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.command === 'setDirectory') {
        const input = $(m.target);
        if (input) { input.value = m.path; onChange(); }
    } else if (m.command === 'buildFileError') {
        showError('buildFileError', buildFileInput, m.message, true);
    } else if (m.command === 'saveFailed') {
        saving = false;
        $('saveTaskBtn').disabled = $('saveRunBtn').disabled = false;
        onChange();
    }
});

$('taskName').addEventListener('blur', () => { touched.add('taskName'); onChange(); });
document.addEventListener('input', (e) => { if (e.target.id !== 'targetFilter' && !e.target.closest('#propList')) { onChange(); } });
document.addEventListener('change', (e) => { if (e.target.id !== 'buildFilePath') { onChange(); } });

// ---------- Init ----------
renderProps();
renderTargets();
onChange();
if (!INIT.isEdit) { $('taskName').select(); }
`;
