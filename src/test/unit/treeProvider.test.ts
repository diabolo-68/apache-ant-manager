import * as assert from 'assert';
import * as path from 'path';
import { AntTaskConfig, AntTaskService } from '../../services/AntTaskService';
import { ScriptTaskService } from '../../services/ScriptTaskService';
import { taskRefOf, WORKSPACE_SCOPE } from '../../taskActions';
import { AntTasksTreeProvider, refFromArg } from '../../views/AntTasksTreeProvider';
import * as vscode from './vscodeStub';

/** Stand-in for TaskActions: the tree only needs getTasks() and onDidChangeTasks. */
function fakeActions(tasks: AntTaskConfig[]) {
    const emitter = new vscode.EventEmitter<void>();
    return { getTasks: () => tasks, onDidChangeTasks: emitter.event, fire: () => emitter.fire() };
}

function tag(task: AntTaskConfig, folderName: string): AntTaskConfig {
    (task as any)._workspaceFolderName = folderName;
    (task as any)._isWorkspaceLevel = folderName === WORKSPACE_SCOPE;
    return task;
}

suite('AntTasksTreeProvider', () => {
    const root = path.resolve('/ws');
    let ant: AntTaskService;

    setup(() => {
        vscode.reset([path.join(root, 'app'), path.join(root, 'lib')]);
        ant = new AntTaskService();
    });

    test('lists tasks flat when they all come from one place', () => {
        const build = tag(ant.generateTaskConfig(path.join(root, 'app', 'build.xml'), ['clean', 'dist'], 'Build'), 'app');
        const tree = new AntTasksTreeProvider(fakeActions([build]) as any, ant);
        const top = tree.getChildren();
        assert.strictEqual(top.length, 1);
        assert.strictEqual(top[0].kind, 'task');

        const item = tree.getTreeItem(top[0]);
        assert.strictEqual(item.label, 'Build');
        assert.strictEqual(item.contextValue, 'antTask');
        assert.strictEqual(item.description, 'build.xml');

        const targets = tree.getChildren(top[0]);
        assert.deepStrictEqual(targets.map(t => t.kind === 'target' && t.target), ['clean', 'dist']);
        const targetItem = tree.getTreeItem(targets[1]);
        assert.strictEqual(targetItem.contextValue, 'antTarget');
        assert.strictEqual(targetItem.description, '2');
    });

    test('groups by folder when tasks come from several places', () => {
        const a = tag(ant.generateTaskConfig(path.join(root, 'app', 'build.xml'), ['x'], 'A'), 'app');
        const b = tag(ant.generateTaskConfig(path.join(root, 'lib', 'build.xml'), ['y'], 'B'), WORKSPACE_SCOPE);
        const tree = new AntTasksTreeProvider(fakeActions([a, b]) as any, ant);
        const scopes = tree.getChildren();
        assert.deepStrictEqual(scopes.map(s => s.kind === 'scope' && s.folderName), ['app', WORKSPACE_SCOPE]);
        assert.strictEqual(tree.getTreeItem(scopes[1]).label, 'Workspace (shared)');
        assert.strictEqual(tree.getTreeItem(scopes[0]).description, '1 task');
    });

    test('script tasks are leaves that open the editor and use the file icon', () => {
        const scripts = new ScriptTaskService(ant, 'linux');
        const spec = scripts.defaultSpec('python', path.join(root, 'app', 'tools', 'etl.py'));
        const task = tag(scripts.toTaskConfig(spec), 'app');
        const tree = new AntTasksTreeProvider(fakeActions([task]) as any, ant);
        const [node] = tree.getChildren();
        assert.deepStrictEqual(tree.getChildren(node), []);
        const item = tree.getTreeItem(node);
        assert.strictEqual(item.contextValue, 'scriptTask');
        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None);
        assert.strictEqual(item.iconPath, vscode.ThemeIcon.File);
        assert.strictEqual(item.description, 'tools/etl.py');
        assert.strictEqual(item.command?.command, 'apache-ant-manager.editTask');
    });

    test('fires a change event when the tasks change', () => {
        const actions = fakeActions([]);
        const tree = new AntTasksTreeProvider(actions as any, ant);
        let fired = 0;
        tree.onDidChangeTreeData(() => fired++);
        actions.fire();
        tree.refresh();
        assert.strictEqual(fired, 2);
    });

    test('refFromArg accepts tree nodes and plain references', () => {
        const ref = { label: 'A', folderName: 'app' };
        assert.deepStrictEqual(refFromArg({ kind: 'task', ref, task: {} }), ref);
        assert.deepStrictEqual(refFromArg({ kind: 'target', ref, target: 't', index: 0 }), ref);
        assert.deepStrictEqual(refFromArg({ label: 'B' }), { label: 'B', folderName: '' });
        assert.strictEqual(refFromArg(undefined), undefined);
        assert.strictEqual(refFromArg('x'), undefined);
    });

    test('taskRefOf uses the tagged folder', () => {
        assert.deepStrictEqual(taskRefOf(tag({ label: 'L' } as any, 'lib')), { label: 'L', folderName: 'lib' });
    });
});
