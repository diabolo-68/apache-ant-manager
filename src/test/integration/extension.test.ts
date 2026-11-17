import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'diabolo-68.apache-ant-manager';

function workspaceRoot(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the test workspace must be open');
    return folder.uri.fsPath;
}

async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, what: string, timeoutMs = 20000): Promise<T> {
    const start = Date.now();
    for (;;) {
        const value = await probe();
        if (value) { return value; }
        if (Date.now() - start > timeoutMs) { throw new Error(`Timed out waiting for ${what}`); }
        await new Promise(r => setTimeout(r, 200));
    }
}

suite('Extension (integration)', () => {
    suiteSetup(async () => {
        const ext = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(ext, `${EXTENSION_ID} must be installed in the test host`);
        await ext.activate();
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('activates in a workspace with an Ant build file', () => {
        assert.strictEqual(vscode.extensions.getExtension(EXTENSION_ID)?.isActive, true);
    });

    test('registers every contributed command', async () => {
        const pkg = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON;
        const contributed: string[] = pkg.contributes.commands.map((c: { command: string }) => c.command);
        const registered = new Set(await vscode.commands.getCommands(true));
        const missing = contributed.filter(c => !registered.has(c));
        assert.deepStrictEqual(missing, []);
    });

    test('the fixture tasks are visible to VS Code\'s task system', async () => {
        const tasks = await vscode.tasks.fetchTasks();
        const names = tasks.map(t => t.name);
        for (const label of ['Build', 'Report', 'Hello']) {
            assert.ok(names.includes(label), `${label} in ${names.join(', ')}`);
        }
    });

    test('running a saved task executes it in the right folder', async () => {
        const root = workspaceRoot();
        const output = path.join(root, 'hello.txt');
        fs.rmSync(output, { force: true });
        const ended = new Promise<number | undefined>(resolve => {
            const sub = vscode.tasks.onDidEndTaskProcess(e => {
                if (e.execution.task.name === 'Hello') { sub.dispose(); resolve(e.exitCode); }
            });
        });
        await vscode.commands.executeCommand('apache-ant-manager.runTargets', { label: 'Hello', folderName: path.basename(root) });
        assert.strictEqual(await ended, 0);
        const text = await waitFor(() => fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : undefined, 'hello.txt');
        assert.match(text.replace(/\0/g, ''), /hello/); // PowerShell writes UTF-16
    });

    test('opening Task Studio shows a webview tab', async () => {
        await vscode.commands.executeCommand('apache-ant-manager.openConfiguration');
        const tab = await waitFor(() => vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .find(t => t.input instanceof vscode.TabInputWebview && t.label === 'Tasks'), 'the Tasks tab');
        assert.ok(tab);
    });

    test('editing a script task opens its editor', async () => {
        await vscode.commands.executeCommand('apache-ant-manager.editTask', { label: 'Report', folderName: path.basename(workspaceRoot()) });
        const tab = await waitFor(() => vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .find(t => t.input instanceof vscode.TabInputWebview && /Report/.test(t.label)), 'the Report editor tab');
        assert.ok(tab);
    });

    test('the status bar remembers the last task for re-run', async () => {
        const root = workspaceRoot();
        const output = path.join(root, 'hello.txt');
        fs.rmSync(output, { force: true });
        await vscode.commands.executeCommand('apache-ant-manager.rerunLastTask');
        await waitFor(() => fs.existsSync(output), 'hello.txt after re-run');
    });
});
