import * as vscode from 'vscode';
import { AntTasksListPanel } from './panels/AntTasksListPanel';
import { AntParserService } from './services/AntParserService';
import { AntTaskService } from './services/AntTaskService';
import { ScriptTaskService } from './services/ScriptTaskService';
import { SCRIPT_KINDS } from './types/taskKinds';
import { TaskActions, taskRefOf } from './taskActions';
import { isAntBuildFile } from './util/antFiles';
import { AntTasksTreeProvider, AntTreeNode, refFromArg } from './views/AntTasksTreeProvider';

export function activate(context: vscode.ExtensionContext) {
    const parserService = new AntParserService(context);
    const taskService = new AntTaskService();
    const scriptService = new ScriptTaskService(taskService);
    const actions = new TaskActions(context, parserService, taskService, scriptService);
    const tree = new AntTasksTreeProvider(actions, taskService);

    const treeView = vscode.window.createTreeView('apacheAntManager.tasks', {
        treeDataProvider: tree,
        showCollapseAll: true
    });

    /** Tree commands receive a node; palette invocations receive nothing, so ask. */
    const resolveRef = async (arg: unknown, placeHolder: string) => {
        const ref = refFromArg(arg);
        if (ref) { return ref; }
        const tasks = actions.getTasks();
        if (tasks.length === 0) {
            vscode.window.showInformationMessage('No tasks yet. Use "Task Manager: New Task…" to create one.');
            return undefined;
        }
        const multi = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
        const picked = await vscode.window.showQuickPick(
            tasks.map(t => ({
                label: `$(${t.taskManager ? SCRIPT_KINDS[t.taskManager.kind]?.icon ?? 'terminal' : 'tools'}) ${t.label}`,
                description: t.taskManager
                    ? [taskService.effectiveCommand(t), ...(t.args ?? [])].join(' ')
                    : taskService.parseAntTask(t).targets?.join(' → ') || '',
                detail: multi ? taskRefOf(t).folderName.replace('__workspace__', 'Workspace (shared)') : undefined,
                ref: taskRefOf(t)
            })),
            { placeHolder }
        );
        return picked?.ref;
    };

    const register = (id: string, fn: (...args: any[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    // Open the task manager webview, or — from the Explorer context menu — a new task for that file.
    register('apache-ant-manager.openConfiguration', async (uri?: vscode.Uri) => {
        if (uri instanceof vscode.Uri) {
            if (!(await isAntBuildFile(uri.fsPath))) {
                vscode.window.showWarningMessage('This file does not appear to be an Apache Ant build file.');
                return;
            }
            await actions.createNew(uri);
        } else {
            AntTasksListPanel.createOrShow(context.extensionUri, actions, taskService);
        }
    });

    register('apache-ant-manager.createTaskFromFile', (uri?: vscode.Uri) =>
        actions.createNew(uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri));

    register('apache-ant-manager.selectBuildFile', () => actions.createNew());

    register('apache-ant-manager.runTargets', async (arg?: AntTreeNode) => {
        const ref = await resolveRef(arg, 'Select a task to run');
        if (ref) { await actions.run(ref); }
    });

    register('apache-ant-manager.editTask', async (arg?: AntTreeNode) => {
        const ref = await resolveRef(arg, 'Select a task to edit');
        if (ref) { actions.edit(ref); }
    });

    register('apache-ant-manager.duplicateTask', async (arg?: AntTreeNode) => {
        const ref = await resolveRef(arg, 'Select a task to duplicate');
        if (ref) { await actions.duplicate(ref); }
    });

    register('apache-ant-manager.deleteTask', async (arg?: AntTreeNode) => {
        const ref = await resolveRef(arg, 'Select a task to delete');
        if (ref) { await actions.delete(ref); }
    });

    register('apache-ant-manager.rerunLastTask', () => actions.rerunLast());

    // Run one target. Called from the tree (node) or programmatically (buildFile, targetName).
    register('apache-ant-manager.runSingleTarget', async (arg: AntTreeNode | string, targetName?: string) => {
        if (typeof arg === 'string' && targetName) {
            await taskService.runAntTargets(arg, [targetName]);
        } else if (arg && typeof arg === 'object' && arg.kind === 'target') {
            await actions.runTarget(arg.ref, arg.target);
        }
    });

    register('apache-ant-manager.refresh', () => actions.notifyChanged());

    context.subscriptions.push(actions, treeView);
}

export function deactivate() {
    // Cleanup handled by disposables
}
