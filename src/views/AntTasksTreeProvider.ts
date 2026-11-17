import * as vscode from 'vscode';
import { AntTaskService, AntTaskConfig } from '../services/AntTaskService';
import { TaskActions, TaskRef, taskRefOf, WORKSPACE_SCOPE } from '../taskActions';
import { displayBuildFile } from '../util/antFiles';
import { SCRIPT_KINDS } from '../types/taskKinds';

export type AntTreeNode =
    | { kind: 'scope'; folderName: string; tasks: AntTaskConfig[] }
    | { kind: 'task'; ref: TaskRef; task: AntTaskConfig }
    | { kind: 'target'; ref: TaskRef; target: string; index: number };

/**
 * Explorer tree: [workspace folder →] saved task → targets (in run order).
 * Folder grouping only appears when tasks come from more than one location.
 */
export class AntTasksTreeProvider implements vscode.TreeDataProvider<AntTreeNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly _actions: TaskActions, private readonly _taskService: AntTaskService) {
        _actions.onDidChangeTasks(() => this._onDidChangeTreeData.fire());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getChildren(node?: AntTreeNode): AntTreeNode[] {
        if (!node) {
            const tasks = this._actions.getTasks();
            const groups = new Map<string, AntTaskConfig[]>();
            for (const task of tasks) {
                const key = taskRefOf(task).folderName;
                groups.set(key, [...(groups.get(key) ?? []), task]);
            }
            if (groups.size > 1) {
                return [...groups.entries()].map(([folderName, list]) => ({ kind: 'scope', folderName, tasks: list }));
            }
            return tasks.map(task => this._taskNode(task));
        }
        if (node.kind === 'scope') {
            return node.tasks.map(task => this._taskNode(task));
        }
        if (node.kind === 'task') {
            if (this._taskService.kindOf(node.task) !== 'ant') { return []; }
            const targets = this._taskService.parseAntTask(node.task).targets ?? [];
            return targets.map((target, index) => ({ kind: 'target', ref: node.ref, target, index }));
        }
        return [];
    }

    private _taskNode(task: AntTaskConfig): AntTreeNode {
        return { kind: 'task', ref: taskRefOf(task), task };
    }

    private _scriptTaskItem(task: AntTaskConfig, ref: TaskRef): vscode.TreeItem {
        const meta = task.taskManager!;
        const info = SCRIPT_KINDS[meta.kind] ?? SCRIPT_KINDS.custom;
        const item = new vscode.TreeItem(task.label, vscode.TreeItemCollapsibleState.None);
        item.id = `task:${ref.folderName}:${ref.label}`;
        item.contextValue = 'scriptTask';

        const commandLine = [this._taskService.effectiveCommand(task), ...(meta.kind === 'custom' ? meta.scriptArgs : [])].join(' ');
        if (meta.kind !== 'custom' && meta.script) {
            // Use the file icon theme (Python, PowerShell, … icons) for script files.
            item.resourceUri = vscode.Uri.file(this._taskService.resolveWorkspacePath(meta.script));
            item.iconPath = vscode.ThemeIcon.File;
            item.description = shortPath(meta.script);
        } else {
            item.iconPath = new vscode.ThemeIcon(info.icon);
            item.description = commandLine;
        }

        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${task.label}** — ${info.label}\n\n`);
        const full = [this._taskService.effectiveCommand(task), ...(task.args ?? [])].join(' ');
        md.appendCodeblock(full, 'shell');
        if (task.options?.cwd) { md.appendMarkdown(`Working directory: \`${task.options.cwd}\``); }
        item.tooltip = md;
        item.command = { command: 'apache-ant-manager.editTask', title: 'Edit', arguments: [{ kind: 'task', ref, task }] };
        return item;
    }

    getTreeItem(node: AntTreeNode): vscode.TreeItem {
        switch (node.kind) {
            case 'scope': {
                const isWs = node.folderName === WORKSPACE_SCOPE;
                const item = new vscode.TreeItem(isWs ? 'Workspace (shared)' : node.folderName, vscode.TreeItemCollapsibleState.Expanded);
                item.iconPath = new vscode.ThemeIcon(isWs ? 'files' : 'root-folder');
                item.description = `${node.tasks.length} task${node.tasks.length === 1 ? '' : 's'}`;
                item.contextValue = 'antScope';
                return item;
            }
            case 'task': {
                if (this._taskService.kindOf(node.task) !== 'ant') {
                    return this._scriptTaskItem(node.task, node.ref);
                }
                const parsed = this._taskService.parseAntTask(node.task);
                const item = new vscode.TreeItem(node.task.label, vscode.TreeItemCollapsibleState.Collapsed);
                item.id = `task:${node.ref.folderName}:${node.ref.label}`;
                item.iconPath = new vscode.ThemeIcon('tools');
                item.description = displayBuildFile(parsed.rawBuildFile || parsed.buildFile);
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**${node.task.label}**\n\n`);
                md.appendMarkdown(`Build file: \`${parsed.buildFile || 'unknown'}\`\n\n`);
                md.appendMarkdown(`Targets: ${(parsed.targets ?? []).map(t => `\`${t}\``).join(' → ') || '_none_'}`);
                if (parsed.additionalArgs) {
                    md.appendMarkdown(`\n\nArguments: \`${parsed.additionalArgs.replace(/\n/g, ' ')}\``);
                }
                item.tooltip = md;
                item.contextValue = 'antTask';
                return item;
            }
            case 'target': {
                const item = new vscode.TreeItem(node.target, vscode.TreeItemCollapsibleState.None);
                item.id = `target:${node.ref.folderName}:${node.ref.label}:${node.index}`;
                item.iconPath = new vscode.ThemeIcon('target');
                item.description = `${node.index + 1}`;
                item.tooltip = `Run only "${node.target}" with this task's settings`;
                item.contextValue = 'antTarget';
                return item;
            }
        }
    }
}

/** Strip ${workspaceFolder…}/ prefixes for display. */
function shortPath(p: string): string {
    return p.replace(/^\$\{workspaceFolder(?::[^}]+)?\}[\\/]?/, '');
}

/** Resolve the task reference from a tree node or a raw TaskRef passed to a command. */
export function refFromArg(arg: unknown): TaskRef | undefined {
    if (!arg || typeof arg !== 'object') { return undefined; }
    const a = arg as any;
    if (a.kind === 'task' || a.kind === 'target') { return a.ref; }
    if (typeof a.label === 'string') { return { label: a.label, folderName: a.folderName ?? '' }; }
    return undefined;
}
