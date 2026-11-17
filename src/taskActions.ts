import * as vscode from 'vscode';
import * as path from 'path';
import { AntConfigurationPanel } from './panels/AntConfigurationPanel';
import { ScriptTaskPanel } from './panels/ScriptTaskPanel';
import { AntParserService } from './services/AntParserService';
import { AntTaskService, AntTaskConfig } from './services/AntTaskService';
import { ScriptTaskService } from './services/ScriptTaskService';
import { SCRIPT_KINDS, SCRIPT_KIND_ORDER, TaskKind, scriptKindForFile } from './types/taskKinds';
import { findAntBuildFiles, isAntBuildFile } from './util/antFiles';

/** Scope id used for tasks stored in the .code-workspace file. */
export const WORKSPACE_SCOPE = '__workspace__';

/** Identifies a saved task: its label plus the folder (or workspace file) it lives in. */
export interface TaskRef {
    label: string;
    folderName: string;
}

const LAST_RUN_KEY = 'apacheAntManager.lastRunTask';

export function taskRefOf(task: AntTaskConfig): TaskRef {
    const t = task as any;
    return { label: task.label, folderName: t._isWorkspaceLevel ? WORKSPACE_SCOPE : (t._workspaceFolderName || '') };
}

const EXCLUDE_GLOB = '**/{node_modules,.git,.svn,target,bin,dist,out,.venv,venv,__pycache__,.vscode-test}/**';

/**
 * Task operations shared by the tree view, the task list webview and commands.
 */
export class TaskActions implements vscode.Disposable {
    private readonly _onDidChangeTasks = new vscode.EventEmitter<void>();
    /** Fires whenever saved Ant tasks may have changed. */
    readonly onDidChangeTasks = this._onDidChangeTasks.event;

    private readonly _statusItem: vscode.StatusBarItem;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _parserService: AntParserService,
        private readonly _taskService: AntTaskService,
        private readonly _scriptService: ScriptTaskService
    ) {
        // Re-read tasks when tasks.json or the workspace file changes on disk.
        const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/tasks.json');
        watcher.onDidChange(() => this.notifyChanged());
        watcher.onDidCreate(() => this.notifyChanged());
        watcher.onDidDelete(() => this.notifyChanged());
        this._disposables.push(watcher);
        const wsFile = vscode.workspace.workspaceFile;
        if (wsFile && wsFile.scheme === 'file') {
            const wsWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(path.dirname(wsFile.fsPath)), path.basename(wsFile.fsPath))
            );
            wsWatcher.onDidChange(() => this.notifyChanged());
            this._disposables.push(wsWatcher);
        }
        this._disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.notifyChanged()));

        this._statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        this._statusItem.command = 'apache-ant-manager.rerunLastTask';
        this._disposables.push(this._statusItem, this._onDidChangeTasks);
        this._disposables.push(this.onDidChangeTasks(() => this._updateStatusItem()));
        this._updateStatusItem();
    }

    notifyChanged(): void {
        this._onDidChangeTasks.fire();
    }

    getTasks(): AntTaskConfig[] {
        return this._taskService.getManagedTasks();
    }

    findTask(ref: TaskRef): AntTaskConfig | undefined {
        const tasks = this.getTasks();
        return tasks.find(t => t.label === ref.label && taskRefOf(t).folderName === ref.folderName)
            ?? tasks.find(t => t.label === ref.label);
    }

    /** Parsed task with the workspace-folder bookkeeping the editor needs. */
    private _parsed(task: AntTaskConfig): AntTaskConfig {
        const parsed = this._taskService.parseAntTask(task);
        (parsed as any)._workspaceFolder = (task as any)._workspaceFolder;
        (parsed as any)._workspaceFolderName = (task as any)._workspaceFolderName;
        (parsed as any)._isWorkspaceLevel = (task as any)._isWorkspaceLevel;
        return parsed;
    }

    async run(ref: TaskRef): Promise<void> {
        const ok = await this._taskService.runSavedTask(ref.label, ref.folderName || undefined);
        if (ok) {
            await this._context.workspaceState.update(LAST_RUN_KEY, ref);
            this._updateStatusItem();
        }
    }

    async rerunLast(): Promise<void> {
        const ref = this._context.workspaceState.get<TaskRef>(LAST_RUN_KEY);
        if (ref && this.findTask(ref)) {
            await this.run(ref);
        } else {
            await vscode.commands.executeCommand('apache-ant-manager.runTargets');
        }
    }

    /** Run one target of a saved task, reusing that task's environment. */
    async runTarget(ref: TaskRef, targetName: string): Promise<void> {
        const task = this.findTask(ref);
        if (!task || this._taskService.kindOf(task) !== 'ant') { return; }
        const parsed = this._taskService.parseAntTask(task);
        if (!parsed.buildFile) {
            vscode.window.showWarningMessage(`Could not determine the build file for "${ref.label}".`);
            return;
        }
        await this._taskService.runAntTargets(
            parsed.buildFile,
            [targetName],
            '',
            parsed.workingDirectory || undefined,
            parsed.antHome || undefined,
            parsed.javaHome || undefined,
            parsed.shell
        );
    }

    edit(ref: TaskRef): void {
        const task = this.findTask(ref);
        if (!task) {
            vscode.window.showWarningMessage(`Task "${ref.label}" no longer exists.`);
            this.notifyChanged();
            return;
        }
        if (this._taskService.kindOf(task) !== 'ant') {
            ScriptTaskPanel.createOrShow(this._context.extensionUri, this._taskService, this._scriptService, {
                task,
                onSaveComplete: () => this.notifyChanged()
            });
            return;
        }
        const parsed = this._parsed(task);
        const rawBuildFilePath = parsed.rawBuildFile || parsed.buildFile || '';
        if (!rawBuildFilePath) {
            vscode.window.showWarningMessage('Could not determine build file for this task');
            return;
        }
        AntConfigurationPanel.createOrShow(
            this._context.extensionUri,
            this._parserService,
            this._taskService,
            rawBuildFilePath,
            {
                isEditMode: true,
                originalLabel: parsed.label,
                task: parsed,
                onSaveComplete: () => this.notifyChanged()
            }
        );
    }

    /**
     * Start a new task. With a file, the kind is inferred from it; otherwise the user
     * picks a kind and then a file (Ant build files and scripts found in the workspace, or "Browse…").
     */
    async createNew(file?: vscode.Uri, kind?: TaskKind): Promise<void> {
        if (file && !kind) {
            kind = (await isAntBuildFile(file.fsPath)) ? 'ant' : scriptKindForFile(file.fsPath);
            if (!kind) {
                kind = await this._pickKind('What should run this file?');
                if (!kind) { return; }
            }
        }
        kind ??= await this._pickKind();
        if (!kind) { return; }

        if (kind === 'ant') {
            const uri = file ?? await this._pickFile('ant');
            if (!uri) { return; }
            AntConfigurationPanel.createOrShow(
                this._context.extensionUri,
                this._parserService,
                this._taskService,
                uri.fsPath,
                { isEditMode: false, onSaveComplete: () => this.notifyChanged() }
            );
            return;
        }

        let scriptPath: string | undefined;
        if (kind !== 'custom') {
            const uri = file ?? await this._pickFile(kind);
            if (!uri) { return; }
            scriptPath = uri.fsPath;
        }
        ScriptTaskPanel.createOrShow(this._context.extensionUri, this._taskService, this._scriptService, {
            kind,
            scriptPath,
            onSaveComplete: () => this.notifyChanged()
        });
    }

    private async _pickKind(title = 'New Task'): Promise<TaskKind | undefined> {
        type Item = vscode.QuickPickItem & { taskKind: TaskKind };
        const items: Item[] = [
            { label: '$(tools) Ant build', description: 'Run targets from an Ant build file', taskKind: 'ant' },
            ...SCRIPT_KIND_ORDER.map(k => ({
                label: `$(${SCRIPT_KINDS[k].icon}) ${SCRIPT_KINDS[k].label}`,
                description: SCRIPT_KINDS[k].description,
                taskKind: k as TaskKind
            }))
        ];
        const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'What kind of task?' });
        return picked?.taskKind;
    }

    /** Quick pick of matching files in the workspace, plus "Browse…". */
    private async _pickFile(kind: TaskKind): Promise<vscode.Uri | undefined> {
        type Item = vscode.QuickPickItem & { uri?: vscode.Uri };
        const info = kind === 'ant' ? undefined : SCRIPT_KINDS[kind];
        const browse: Item = { label: '$(folder-opened) Browse…', description: 'Pick any file on disk', alwaysShow: true };

        const qp = vscode.window.createQuickPick<Item>();
        qp.title = kind === 'ant' ? 'New Ant Task' : `New ${info!.label} Task`;
        qp.placeholder = kind === 'ant' ? 'Select the Ant build file for this task' : `Select the ${info!.label.toLowerCase()} to run`;
        qp.matchOnDescription = true;
        qp.busy = true;
        qp.items = [browse];
        qp.show();

        const cts = new vscode.CancellationTokenSource();
        const find: Thenable<vscode.Uri[]> = kind === 'ant'
            ? findAntBuildFiles(cts.token)
            : vscode.workspace.findFiles(`**/*.{${info!.extensions.join(',')}}`, EXCLUDE_GLOB, 500, cts.token)
                .then(files => files.sort((a, b) => a.fsPath.localeCompare(b.fsPath)));
        find.then(files => {
            const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
            const items: Item[] = files.map(uri => ({
                label: `$(file-code) ${path.basename(uri.fsPath)}`,
                description: vscode.workspace.asRelativePath(path.dirname(uri.fsPath), multiRoot),
                uri
            }));
            qp.items = items.length
                ? [...items, { label: '', kind: vscode.QuickPickItemKind.Separator }, browse]
                : [browse];
            qp.busy = false;
        }, () => { qp.busy = false; });

        const picked = await new Promise<Item | undefined>(resolve => {
            qp.onDidAccept(() => resolve(qp.selectedItems[0]));
            qp.onDidHide(() => resolve(undefined));
        });
        cts.cancel();
        qp.dispose();

        if (!picked) { return undefined; }
        if (picked.uri) { return picked.uri; }

        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: kind === 'ant'
                ? { 'Ant Build Files': ['xml'] }
                : { [info!.label]: info!.extensions, 'All files': ['*'] },
            title: kind === 'ant' ? 'Select Ant Build File' : `Select ${info!.label}`
        });
        return files?.[0];
    }

    async duplicate(ref: TaskRef): Promise<void> {
        const task = this.findTask(ref);
        if (!task) { return; }

        const existing = new Set(this.getTasks().map(t => t.label));
        let label = `${task.label} (copy)`;
        for (let n = 2; existing.has(label); n++) {
            label = `${task.label} (copy ${n})`;
        }

        // Copy the stored task, dropping the in-memory bookkeeping fields.
        const copy: AntTaskConfig = JSON.parse(JSON.stringify(task, (key, value) => key.startsWith('_') ? undefined : value));
        copy.label = label;

        try {
            const t = task as any;
            if (t._isWorkspaceLevel) {
                await this._taskService.saveTaskToWorkspace(copy, undefined, true);
            } else {
                await this._taskService.saveTaskToWorkspace(copy, t._workspaceFolder);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to duplicate task: ${error}`);
            return;
        }
        this.notifyChanged();
        this.edit({ label, folderName: ref.folderName });
    }

    async delete(ref: TaskRef): Promise<void> {
        const task = this.findTask(ref);
        if (!task) { return; }
        const location = ref.folderName === WORKSPACE_SCOPE ? 'the workspace file' : `${ref.folderName || 'workspace'}/.vscode/tasks.json`;
        const confirm = await vscode.window.showWarningMessage(
            `Delete task "${ref.label}"?`,
            { modal: true, detail: `It will be removed from ${location}.` },
            'Delete'
        );
        if (confirm !== 'Delete') { return; }
        try {
            const t = task as any;
            await this._taskService.deleteTask(ref.label, t._isWorkspaceLevel ? WORKSPACE_SCOPE : t._workspaceFolder);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete task: ${error}`);
        }
        this.notifyChanged();
    }

    private _updateStatusItem(): void {
        const ref = this._context.workspaceState.get<TaskRef>(LAST_RUN_KEY);
        if (ref && this.findTask(ref)) {
            this._statusItem.text = `$(play) ${ref.label}`;
            this._statusItem.tooltip = `Run task "${ref.label}" again`;
            this._statusItem.show();
        } else {
            this._statusItem.hide();
        }
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }
}
