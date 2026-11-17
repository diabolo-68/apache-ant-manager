import * as vscode from 'vscode';
import * as fs from 'fs';
import { AntTaskConfig, AntTaskService } from '../services/AntTaskService';
import { ScriptTaskService } from '../services/ScriptTaskService';
import { SCRIPT_KINDS, SCRIPT_KIND_ORDER, ScriptKind, ScriptTaskSpec } from '../types/taskKinds';
import { escapeHtml, icon, renderPage } from './webviewUtils';

const WORKSPACE_SCOPE = '__workspace__';

export interface ScriptEditContext {
    /** Present when editing an existing task. */
    task?: AntTaskConfig;
    /** For new tasks. */
    kind?: ScriptKind;
    scriptPath?: string;
    onSaveComplete?: () => void;
}

/**
 * Webview editor for script and command tasks (shell, batch, PowerShell, Python, Node.js, custom).
 */
export class ScriptTaskPanel {
    public static currentPanel: ScriptTaskPanel | undefined;
    public static readonly viewType = 'scriptTaskEditor';

    private readonly _panel: vscode.WebviewPanel;
    private _ctx: ScriptEditContext;
    private _dirty = false;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        taskService: AntTaskService,
        scriptService: ScriptTaskService,
        ctx: ScriptEditContext
    ): void {
        const column = vscode.window.activeTextEditor?.viewColumn;
        if (ScriptTaskPanel.currentPanel) {
            const current = ScriptTaskPanel.currentPanel;
            current._ctx = ctx;
            current._dirty = false;
            current._panel.reveal(column);
            current._render();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            ScriptTaskPanel.viewType,
            'Task',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
                retainContextWhenHidden: true
            }
        );
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');
        ScriptTaskPanel.currentPanel = new ScriptTaskPanel(panel, extensionUri, taskService, scriptService, ctx);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private readonly _extensionUri: vscode.Uri,
        private readonly _taskService: AntTaskService,
        private readonly _scriptService: ScriptTaskService,
        ctx: ScriptEditContext
    ) {
        this._panel = panel;
        this._ctx = ctx;
        this._render();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(m => this._onMessage(m), null, this._disposables);
    }

    private get _isEdit(): boolean {
        return !!this._ctx.task;
    }

    private _baseTitle(): string {
        if (this._ctx.task) { return `Edit: ${this._ctx.task.label}`; }
        return `New ${SCRIPT_KINDS[this._ctx.kind ?? 'custom'].label}`;
    }

    private _setDirty(dirty: boolean): void {
        this._dirty = dirty;
        this._panel.title = (dirty ? '● ' : '') + this._baseTitle();
    }

    private async _onMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'saveTask':
                await this._save(message.spec as ScriptTaskSpec, message.folderName, !!message.run);
                break;
            case 'cancel':
                if (this._dirty) {
                    const choice = await vscode.window.showWarningMessage('Discard unsaved changes to this task?', { modal: true }, 'Discard');
                    if (choice !== 'Discard') { return; }
                }
                this.dispose();
                break;
            case 'dirty':
                this._setDirty(!!message.dirty);
                break;
            case 'browseScript': {
                const info = SCRIPT_KINDS[message.kind as ScriptKind];
                const files = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectMany: false,
                    filters: info.extensions.length ? { [info.label]: info.extensions, 'All files': ['*'] } : undefined,
                    title: `Select ${info.label}`,
                    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
                });
                if (files?.[0]) {
                    this._post({ command: 'setValue', target: 'script', value: files[0].fsPath });
                }
                break;
            }
            case 'browseInterpreter': {
                const files = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, title: 'Select executable' });
                if (files?.[0]) {
                    this._post({ command: 'setValue', target: 'interpreter', value: files[0].fsPath });
                }
                break;
            }
            case 'browseDirectory': {
                const folders = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title: 'Select Working Directory' });
                if (folders?.[0]) {
                    this._post({ command: 'setValue', target: 'cwd', value: folders[0].fsPath });
                }
                break;
            }
            case 'checkScript': {
                const resolved = this._taskService.resolveWorkspacePath(String(message.path || ''));
                this._post({ command: 'scriptStatus', path: message.path, exists: !!resolved && fs.existsSync(resolved) });
                break;
            }
            case 'openScript': {
                const resolved = this._taskService.resolveWorkspacePath(String(message.path || ''));
                if (resolved && fs.existsSync(resolved)) {
                    await vscode.window.showTextDocument(vscode.Uri.file(resolved), { preview: false, viewColumn: vscode.ViewColumn.Beside });
                }
                break;
            }
        }
    }

    private _post(message: unknown): void {
        this._panel.webview.postMessage(message);
    }

    private async _save(spec: ScriptTaskSpec, folderName: string, runAfterSave: boolean): Promise<void> {
        try {
            const config = this._scriptService.toTaskConfig(spec);
            const folders = vscode.workspace.workspaceFolders || [];
            const toWorkspaceFile = folderName === WORKSPACE_SCOPE;
            const targetFolder = toWorkspaceFile ? null : folders.find(f => f.name === folderName);

            const editTask = this._ctx.task as any;
            if (editTask) {
                const source = editTask._isWorkspaceLevel ? WORKSPACE_SCOPE : editTask._workspaceFolder;
                await this._taskService.updateTask(editTask.label, config, targetFolder, source);
            } else {
                await this._taskService.saveTaskToWorkspace(config, targetFolder || undefined, toWorkspaceFile);
            }
            this._ctx.onSaveComplete?.();

            if (runAfterSave) {
                await this._scriptService.run(spec, targetFolder || undefined);
            }
            this._dirty = false;
            this.dispose();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save task: ${error}`);
            this._post({ command: 'saveFailed' });
        }
    }

    private _takenLabels(): Record<string, string[]> {
        const editTask = this._ctx.task as any;
        const editScope = editTask ? (editTask._isWorkspaceLevel ? WORKSPACE_SCOPE : editTask._workspaceFolderName) : undefined;
        const result: Record<string, string[]> = {};
        for (const t of this._taskService.getManagedTasks() as any[]) {
            const scope = t._isWorkspaceLevel ? WORKSPACE_SCOPE : t._workspaceFolderName;
            if (editTask && t.label === editTask.label && scope === editScope) { continue; }
            (result[scope] ??= []).push(t.label);
        }
        return result;
    }

    private _render(): void {
        this._panel.title = (this._dirty ? '● ' : '') + this._baseTitle();
        this._panel.webview.html = this._getHtml(this._panel.webview);
    }

    private _getHtml(webview: vscode.Webview): string {
        const editTask = this._ctx.task as any;
        const spec: ScriptTaskSpec = editTask
            ? this._scriptService.specFromTask(editTask)
            : this._scriptService.defaultSpec(this._ctx.kind ?? 'custom', this._ctx.scriptPath);

        const folders = vscode.workspace.workspaceFolders || [];
        const isMultiRootWorkspace = this._taskService.isMultiRootWorkspace();
        const showFolderPicker = folders.length > 1 || isMultiRootWorkspace;
        let folderName: string;
        if (editTask) {
            folderName = editTask._isWorkspaceLevel ? WORKSPACE_SCOPE : (editTask._workspaceFolderName || folders[0]?.name || '');
        } else {
            const fromScript = this._ctx.scriptPath ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this._ctx.scriptPath)) : undefined;
            folderName = fromScript?.name || folders[0]?.name || '';
        }
        const folder = folders.find(f => f.name === folderName);

        const isWindows = process.platform === 'win32';
        const kinds = Object.fromEntries(SCRIPT_KIND_ORDER.map(k => {
            const info = SCRIPT_KINDS[k];
            return [k, {
                label: info.label,
                shortLabel: info.shortLabel,
                icon: info.icon,
                interpreterLabel: info.interpreterLabel,
                defaultInterpreter: info.defaultInterpreter(isWindows),
                defaultInterpreterArgs: info.defaultInterpreterArgs(isWindows),
                extensions: info.extensions,
                suggestions: this._scriptService.interpreterSuggestions(k, folder)
            }];
        }));

        const init = {
            spec,
            folderName,
            kinds,
            takenLabels: this._takenLabels(),
            isEdit: this._isEdit,
            hasScriptFromContext: !!this._ctx.scriptPath
        };
        const initJson = JSON.stringify(init).replace(/</g, '\\u003c');

        const sel = (id: string, options: [string, string][], value: string) =>
            `<select id="${id}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>`;

        const body = `
<div class="container">
    <header class="page-header">
        <h1><span id="kindIcon">${icon(SCRIPT_KINDS[spec.kind].icon)}</span> <span id="pageTitle"></span></h1>
    </header>

    <section class="card">
        <h2>Task</h2>
        <div class="form-grid">
            <label for="kind">Type</label>
            ${sel('kind', SCRIPT_KIND_ORDER.map(k => [k, SCRIPT_KINDS[k].label]), spec.kind)}

            <label for="taskName">Name</label>
            <input type="text" id="taskName" value="${escapeHtml(spec.label)}" placeholder="e.g. Deploy to staging">
            <div class="field-error" id="taskNameError" hidden></div>

            ${showFolderPicker ? `
            <label for="workspaceFolder">Save to</label>
            <select id="workspaceFolder">
                ${folders.map(f => `<option value="${escapeHtml(f.name)}" ${f.name === folderName ? 'selected' : ''}>${escapeHtml(f.name)} — .vscode/tasks.json</option>`).join('')}
                ${isMultiRootWorkspace ? `<option value="${WORKSPACE_SCOPE}" ${folderName === WORKSPACE_SCOPE ? 'selected' : ''}>Workspace (shared) — .code-workspace</option>` : ''}
            </select>` : `<input type="hidden" id="workspaceFolder" value="${escapeHtml(folderName)}">`}
        </div>
    </section>

    <section class="card" id="scriptCard">
        <h2 id="scriptHeading">Script</h2>
        <div class="input-group">
            <input type="text" id="script" value="${escapeHtml(spec.script)}" placeholder="Path to the script" spellcheck="false" aria-label="Script path">
            <button class="secondary" id="browseScript">Browse…</button>
            <button class="icon-btn" id="openScript" title="Open script in editor" aria-label="Open script in editor">${icon('go-to-file')}</button>
        </div>
        <div class="field-error" id="scriptError" hidden style="margin-top:6px"></div>
    </section>

    <section class="card" id="commandCard">
        <h2>Command</h2>
        <div class="form-grid">
            <label for="command">Program</label>
            <div class="input-group">
                <input type="text" id="command" list="interpreterList" placeholder="e.g. make, gradle, docker" spellcheck="false">
                <button class="icon-btn" data-browse-interpreter title="Browse for executable" aria-label="Browse for executable">${icon('folder-opened')}</button>
            </div>
            <div class="field-error" id="commandError" hidden></div>
            <div class="full check-row">
                <label><input type="checkbox" id="useShell" ${spec.useShell ? 'checked' : ''}> Run through the shell <span class="help-text" style="margin:0">— allows pipes, <code>&amp;&amp;</code>, wildcards and environment variable expansion</span></label>
            </div>
        </div>
    </section>

    <section class="card">
        <h2>Arguments</h2>
        <p class="help-text" id="argsHelp">One argument per line. No quoting needed — spaces are kept as part of the argument.</p>
        <textarea id="scriptArgs" rows="3" spellcheck="false" aria-label="Arguments">${escapeHtml(spec.scriptArgs.join('\n'))}</textarea>
    </section>

    <section class="card" id="interpreterCard">
        <h2 id="interpreterHeading">Interpreter</h2>
        <div class="form-grid">
            <label for="interpreter" id="interpreterLabel">Interpreter</label>
            <div class="input-group">
                <input type="text" id="interpreter" list="interpreterList" spellcheck="false">
                <button class="icon-btn" data-browse-interpreter title="Browse for executable" aria-label="Browse for interpreter">${icon('folder-opened')}</button>
            </div>
            <div class="field-error" id="interpreterError" hidden></div>
            <label for="interpreterArgs">Options</label>
            <input type="text" id="interpreterArgs" spellcheck="false" placeholder="Options passed before the script">
            <div class="hint" id="interpreterHint"></div>
        </div>
    </section>
    <datalist id="interpreterList"></datalist>

    <details class="card" id="envSection" ${spec.cwd || Object.keys(spec.env).length ? 'open' : ''}>
        <summary>Environment <span class="summary-hint" id="envSummary"></span></summary>
        <div class="form-grid">
            <label for="cwd">Working directory</label>
            <div class="input-group">
                <input type="text" id="cwd" value="${escapeHtml(spec.cwd)}" placeholder="Workspace folder (default)" spellcheck="false">
                <button class="icon-btn" id="browseCwd" title="Browse…" aria-label="Browse for working directory">${icon('folder-opened')}</button>
            </div>
        </div>
        <div class="subheading">Environment variables</div>
        <div class="prop-list" id="envList"></div>
        <button class="inline-link" id="addEnv">${icon('add')} Add variable</button>
    </details>

    <details class="card" id="terminalSection" ${spec.group !== 'none' || spec.reveal !== 'always' || spec.panel !== 'dedicated' || spec.clear ? 'open' : ''}>
        <summary>Terminal &amp; grouping</summary>
        <div class="form-grid">
            <label for="group">Task group</label>
            ${sel('group', [['none', 'None'], ['build', 'Build (Ctrl+Shift+B)'], ['test', 'Test']], spec.group)}
            <label for="reveal">Show terminal</label>
            ${sel('reveal', [['always', 'Always'], ['silent', 'Only on problems'], ['never', 'Never']], spec.reveal)}
            <label for="panel">Terminal</label>
            ${sel('panel', [['dedicated', 'Dedicated to this task'], ['shared', 'Shared with other tasks'], ['new', 'New on every run']], spec.panel)}
            <div></div>
            <div class="check-row"><label><input type="checkbox" id="clear" ${spec.clear ? 'checked' : ''}> Clear the terminal before running</label></div>
        </div>
    </details>

    <section class="card">
        <h2>Command preview</h2>
        <pre class="command-preview" id="commandPreview"></pre>
    </section>

    <footer class="action-bar">
        <span class="status" id="status" aria-live="polite"></span>
        <button class="secondary" id="cancelBtn">Cancel</button>
        <button class="secondary" id="saveRunBtn" title="Save the task and run it now (Ctrl+Enter)">${icon('play')} Save &amp; Run</button>
        <button class="primary" id="saveTaskBtn" title="Save (Ctrl+S)">${icon('save')} ${this._isEdit ? 'Update Task' : 'Save Task'}</button>
    </footer>
</div>`;

        return renderPage(webview, this._extensionUri, {
            title: this._baseTitle(),
            body,
            script: `const INIT = ${initJson};\n${SCRIPT_EDITOR_JS}`
        });
    }

    public dispose(): void {
        ScriptTaskPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}

const SCRIPT_EDITOR_JS = String.raw`
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

const S = INIT.spec;
let kind = S.kind;
let attemptedSave = false;
let nameTouched = INIT.isEdit;
const touched = new Set();
let env = Object.entries(S.env || {}).map(([key, value]) => ({ key, value }));
let scriptExists = true;

// Split a single-line option string into argv, honouring quotes (quotes are removed).
function splitArgs(str) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(str || ''))) { out.push(m[1] ?? m[2] ?? m[3]); }
    return out;
}
function joinArgs(list) { return list.map(a => /[\s"]/.test(a) || a === '' ? '"' + a.replace(/"/g, '\\"') + '"' : a).join(' '); }
function lines(str) { return String(str || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean); }

// ---------- Kind handling ----------
if (kind === 'custom') { $('command').value = S.interpreter; } else { $('interpreter').value = S.interpreter; }
$('interpreterArgs').value = joinArgs(S.interpreterArgs || []);

function applyKind(prevKind) {
    const k = INIT.kinds[kind];
    const isCustom = kind === 'custom';
    $('scriptCard').hidden = isCustom;
    $('interpreterCard').hidden = isCustom;
    $('commandCard').hidden = !isCustom;
    $('kindIcon').innerHTML = '<i class="codicon codicon-' + k.icon + '" aria-hidden="true"></i>';
    $('pageTitle').textContent = (INIT.isEdit ? 'Edit ' : 'New ') + k.label;
    $('scriptHeading').textContent = k.label.replace(/ script$/, '') + ' script';
    $('interpreterLabel').textContent = k.interpreterLabel;
    $('interpreterHeading').textContent = k.interpreterLabel;
    $('script').placeholder = k.extensions.length ? 'Path to a ' + k.extensions.map(e => '.' + e).join(' / ') + ' file' : 'Path to the script';
    $('interpreterHint').innerHTML = 'Default: <code>' + esc([k.defaultInterpreter, ...k.defaultInterpreterArgs].join(' ')) + '</code> · <button class="inline-link" id="resetInterpreter">Reset to default</button>';
    $('resetInterpreter').addEventListener('click', () => {
        $('interpreter').value = k.defaultInterpreter;
        $('interpreterArgs').value = joinArgs(k.defaultInterpreterArgs);
        onChange();
    });
    $('interpreterList').innerHTML = k.suggestions.map(s => '<option value="' + esc(s) + '"></option>').join('');

    if (prevKind && prevKind !== kind) {
        const prev = INIT.kinds[prevKind];
        // Switch interpreter defaults only when the user kept the previous defaults.
        if (prevKind === 'custom' || $('interpreter').value.trim() === prev.defaultInterpreter || !$('interpreter').value.trim()) {
            $('interpreter').value = k.defaultInterpreter;
        }
        if ($('interpreterArgs').value.trim() === joinArgs(prev.defaultInterpreterArgs)) {
            $('interpreterArgs').value = joinArgs(k.defaultInterpreterArgs);
        }
        if (!nameTouched) { autoName(); }
    }
    $('argsHelp').textContent = isCustom && $('useShell').checked
        ? 'One argument per line. Arguments are appended to the command line and interpreted by the shell.'
        : 'One argument per line. No quoting needed — spaces are kept as part of the argument.';
}

function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
function autoName() {
    const k = INIT.kinds[kind];
    if (kind === 'custom') {
        const prog = $('command').value.trim().split(/\s+/)[0];
        if (prog) { $('taskName').value = 'Run ' + baseName(prog); }
    } else if ($('script').value.trim()) {
        $('taskName').value = k.shortLabel + ': ' + baseName($('script').value.trim());
    }
}

$('kind').addEventListener('change', (e) => { const prev = kind; kind = e.target.value; applyKind(prev); onChange(); });

// ---------- Environment variables ----------
function renderEnv() {
    $('envList').innerHTML = env.map((p, i) =>
        '<div class="prop-row" data-i="' + i + '">' +
            '<input type="text" class="prop-key" placeholder="NAME" value="' + esc(p.key) + '" aria-label="Variable name" spellcheck="false">' +
            '<span class="eq">=</span>' +
            '<input type="text" class="prop-value" placeholder="value" value="' + esc(p.value) + '" aria-label="Variable value" spellcheck="false">' +
            '<button class="icon-btn danger env-remove" title="Remove variable" aria-label="Remove variable"><i class="codicon codicon-close"></i></button>' +
        '</div>').join('');
}
$('envList').addEventListener('input', (e) => {
    const row = e.target.closest('.prop-row');
    if (!row) { return; }
    const p = env[+row.dataset.i];
    if (e.target.classList.contains('prop-key')) { p.key = e.target.value.trim(); } else { p.value = e.target.value; }
    onChange();
});
$('envList').addEventListener('click', (e) => {
    const btn = e.target.closest('.env-remove');
    if (!btn) { return; }
    env.splice(+btn.closest('.prop-row').dataset.i, 1);
    renderEnv();
    onChange();
});
$('addEnv').addEventListener('click', () => {
    env.push({ key: '', value: '' });
    renderEnv();
    const keys = $('envList').querySelectorAll('.prop-key');
    keys[keys.length - 1].focus();
});

// ---------- Model ----------
function spec() {
    const isCustom = kind === 'custom';
    const envObj = {};
    for (const p of env) { if (p.key) { envObj[p.key] = p.value; } }
    return {
        kind,
        label: $('taskName').value.trim(),
        interpreter: isCustom ? $('command').value.trim() : $('interpreter').value.trim(),
        interpreterArgs: isCustom ? [] : splitArgs($('interpreterArgs').value),
        script: isCustom ? '' : $('script').value.trim(),
        scriptArgs: lines($('scriptArgs').value),
        useShell: isCustom && $('useShell').checked,
        cwd: $('cwd').value.trim(),
        env: envObj,
        group: $('group').value,
        reveal: $('reveal').value,
        panel: $('panel').value,
        clear: $('clear').checked
    };
}

function validate(s) {
    const errors = {};
    const folder = $('workspaceFolder').value;
    if (!s.label) { errors.taskName = 'Enter a name for the task.'; }
    else if ((INIT.takenLabels[folder] || []).includes(s.label)) { errors.taskName = 'A task with this name already exists in this location.'; }
    if (s.kind === 'custom') {
        if (!s.interpreter) { errors.command = 'Enter the program or command to run.'; }
    } else {
        if (!s.script) { errors.script = 'Choose the script to run.'; }
        if (!s.interpreter) { errors.interpreter = 'Enter the interpreter to use.'; }
    }
    return errors;
}

function showError(id, inputEl, msg, visible, warning) {
    const el = $(id);
    el.hidden = !(msg && visible);
    el.style.color = warning ? 'var(--vscode-editorWarning-foreground, var(--muted))' : '';
    el.innerHTML = msg ? '<i class="codicon codicon-' + (warning ? 'warning' : 'error') + '"></i> ' + esc(msg) : '';
    if (inputEl) { inputEl.classList.toggle('invalid', !!(msg && visible && !warning)); }
}

function renderPreview(s) {
    let parts;
    if (s.kind === 'custom') {
        parts = [s.useShell ? s.interpreter : joinArgs([s.interpreter])].concat(s.useShell ? s.scriptArgs : s.scriptArgs.map(a => joinArgs([a])));
    } else {
        parts = [joinArgs([s.interpreter]), joinArgs(s.interpreterArgs), joinArgs([s.script]), joinArgs(s.scriptArgs)];
    }
    let text = parts.filter(Boolean).join(' ');
    const envKeys = Object.keys(s.env);
    if (envKeys.length) { text = envKeys.map(k => k + '=' + joinArgs([s.env[k]])).join(' ') + ' ' + text; }
    text = '# in ' + (s.cwd || 'the workspace folder') + '\n' + text;
    $('commandPreview').textContent = text;
    const summary = [];
    if (s.cwd) { summary.push('custom working directory'); }
    if (envKeys.length) { summary.push(envKeys.length + ' variable' + (envKeys.length > 1 ? 's' : '')); }
    $('envSummary').textContent = summary.length ? '— ' + summary.join(', ') : '';
}

const initialSnapshot = JSON.stringify([spec(), $('workspaceFolder').value]);
let lastDirty = false;

function onChange() {
    const s = spec();
    const errors = validate(s);
    const showAll = attemptedSave;
    showError('taskNameError', $('taskName'), errors.taskName, showAll || touched.has('taskName'));
    showError('commandError', $('command'), errors.command, showAll || touched.has('command'));
    showError('interpreterError', $('interpreter'), errors.interpreter, showAll || touched.has('interpreter'));
    if (errors.script) {
        showError('scriptError', $('script'), errors.script, showAll || touched.has('script'));
    } else {
        showError('scriptError', $('script'), scriptExists ? '' : 'File not found. The task will fail until it exists.', true, true);
    }

    const dirty = JSON.stringify([s, $('workspaceFolder').value]) !== initialSnapshot;
    if (dirty !== lastDirty) { lastDirty = dirty; vscode.postMessage({ command: 'dirty', dirty }); }

    const status = $('status');
    const list = Object.values(errors);
    if (showAll && list.length) { status.textContent = list.join(' '); status.classList.add('error'); }
    else { status.textContent = dirty ? 'Unsaved changes' : ''; status.classList.remove('error'); }

    renderPreview(s);
    return errors;
}

// ---------- Script file ----------
let checkTimer;
function checkScript() {
    clearTimeout(checkTimer);
    const p = $('script').value.trim();
    if (!p || kind === 'custom') { scriptExists = true; onChange(); return; }
    checkTimer = setTimeout(() => vscode.postMessage({ command: 'checkScript', path: p }), 250);
}
$('script').addEventListener('input', () => { if (!nameTouched) { autoName(); } checkScript(); });
$('script').addEventListener('blur', () => { touched.add('script'); onChange(); });
$('browseScript').addEventListener('click', () => vscode.postMessage({ command: 'browseScript', kind }));
$('openScript').addEventListener('click', () => vscode.postMessage({ command: 'openScript', path: $('script').value.trim() }));
$('command').addEventListener('input', () => { if (!nameTouched) { autoName(); } });
$('command').addEventListener('blur', () => { touched.add('command'); onChange(); });
$('interpreter').addEventListener('blur', () => { touched.add('interpreter'); onChange(); });
$('useShell').addEventListener('change', () => applyKind());
document.querySelectorAll('[data-browse-interpreter]').forEach(b => b.addEventListener('click', () => vscode.postMessage({ command: 'browseInterpreter' })));
$('browseCwd').addEventListener('click', () => vscode.postMessage({ command: 'browseDirectory' }));

$('taskName').addEventListener('input', () => { nameTouched = true; });
$('taskName').addEventListener('blur', () => { touched.add('taskName'); onChange(); });

window.addEventListener('message', (event) => {
    const m = event.data;
    if (m.command === 'setValue') {
        const target = m.target === 'interpreter' && kind === 'custom' ? 'command' : m.target;
        $(target).value = m.value;
        if (target === 'script') { if (!nameTouched) { autoName(); } checkScript(); }
        if (target === 'command' && !nameTouched) { autoName(); }
        onChange();
    } else if (m.command === 'scriptStatus') {
        if (m.path === $('script').value.trim()) { scriptExists = m.exists; onChange(); }
    } else if (m.command === 'saveFailed') {
        saving = false;
        $('saveTaskBtn').disabled = $('saveRunBtn').disabled = false;
        onChange();
    }
});

// ---------- Save / cancel ----------
let saving = false;
function save(run) {
    if (saving) { return; }
    attemptedSave = true;
    const errors = onChange();
    const firstInvalid = ['taskName', 'script', 'command', 'interpreter'].find(k => errors[k]);
    if (firstInvalid) { $(firstInvalid).focus(); return; }
    saving = true;
    $('saveTaskBtn').disabled = $('saveRunBtn').disabled = true;
    $('status').textContent = 'Saving…';
    vscode.postMessage({ command: 'saveTask', spec: spec(), folderName: $('workspaceFolder').value, run });
}
$('saveTaskBtn').addEventListener('click', () => save(false));
$('saveRunBtn').addEventListener('click', () => save(true));
$('cancelBtn').addEventListener('click', () => vscode.postMessage({ command: 'cancel' }));
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save(true); }
});
document.addEventListener('input', (e) => { if (!e.target.closest('#envList')) { onChange(); } });
document.addEventListener('change', () => onChange());

// ---------- Init ----------
renderEnv();
applyKind();
onChange();
if (S.script && kind !== 'custom') { checkScript(); }
if (!INIT.isEdit) { $('taskName').select(); }
`;
