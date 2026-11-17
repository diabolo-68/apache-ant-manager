import * as fs from 'fs';
import * as path from 'path';
import { expect, pickQuickItem, readTasks, runCommand, taskView, test, treeItem, webview } from './vscode';

test.describe('Explorer view', () => {
    test('lists saved tasks, with Ant targets as children', async ({ vscode }) => {
        const view = await taskView(vscode.page);
        await expect(treeItem(view, 'Build')).toBeVisible();
        await expect(treeItem(view, 'Report')).toContainText('scripts/report.py');
        await expect(treeItem(view, 'Hello')).toContainText('echo hello > hello.txt');

        await treeItem(view, 'Build').click();
        for (const target of ['clean', 'dist']) {
            await expect(treeItem(view, target)).toBeVisible();
        }
    });

    test('runs a task from the inline action and offers re-run in the status bar', async ({ vscode }) => {
        const output = path.join(vscode.workspace, 'hello.txt');
        const view = await taskView(vscode.page);
        const row = treeItem(view, 'Hello');
        await row.hover();
        await row.getByRole('button', { name: 'Run Task…' }).click();
        await expect.poll(() => fs.existsSync(output), { timeout: 20_000 }).toBe(true);

        const rerun = vscode.page.locator('.statusbar-item', { hasText: 'Hello' });
        await expect(rerun).toBeVisible();
        fs.rmSync(output);
        await rerun.click();
        await expect.poll(() => fs.existsSync(output), { timeout: 20_000 }).toBe(true);
    });
});

test.describe('Task list', () => {
    test('shows every task with its kind and opens the editor on click', async ({ vscode }) => {
        await runCommand(vscode.page, 'Task Studio: Open Task Studio');
        const list = await webview(vscode.page, '.task-row');
        const rows = list.locator('.task-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.filter({ hasText: 'Build' })).toContainText('Ant');
        await expect(rows.filter({ hasText: 'Report' })).toContainText('Python');

        await rows.filter({ hasText: 'Report' }).locator('.task-name, .task-label, strong').first().click();
        const editor = await webview(vscode.page, '#scriptArgs');
        await expect(editor.locator('#taskName')).toHaveValue('Report');
        await expect(editor.locator('#scriptArgs')).toHaveValue('--month\n11');
    });
});

test.describe('Ant task editor', () => {
    test('creates a task from the "New Task" flow', async ({ vscode }) => {
        const { page, workspace } = vscode;
        await runCommand(page, 'Task Studio: New Task…');
        await pickQuickItem(page, 'Ant build');
        await expect(page.locator('.quick-input-widget .monaco-list-row', { hasText: 'modules' })).toBeVisible();
        await pickQuickItem(page, 'build.xml', ''); // unfiltered: the root build.xml is listed first

        const editor = await webview(page, '#targetList');
        await expect(editor.locator('.target-row')).toHaveCount(6);
        await expect(editor.locator('.target-row[data-name="dist"]')).toContainText('default');

        // The build file's default target is preselected
        await expect(editor.locator('.target-row.selected')).toHaveCount(1);
        await expect(editor.locator('.target-row.selected')).toHaveAttribute('data-name', 'dist');

        await editor.locator('#taskName').fill('Package');
        await editor.locator('.target-row[data-name="dist"]').click(); // deselect
        await editor.locator('.target-row[data-name="compile"]').click();
        await editor.locator('.target-row[data-name="dist"]').click();
        await expect(editor.locator('#selectedCount')).toContainText('2');
        await expect(editor.locator('#commandPreview')).toContainText('compile dist');

        await editor.locator('#saveTaskBtn').click();
        await expect.poll(() => readTasks(workspace).tasks.map(t => t.label)).toEqual(['Build', 'Report', 'Hello', 'Package']);
        const saved = readTasks(workspace);
        expect(saved.text).toContain('// Tasks used by the integration and e2e tests');
        expect(saved.tasks[3].args).toEqual(['-f', '${workspaceFolder}/build.xml', 'compile', 'dist']);

        await expect(treeItem(await taskView(page), 'Package')).toBeVisible();
    });

    test('validates the name and the target selection', async ({ vscode }) => {
        const { page } = vscode;
        await runCommand(page, 'Task Studio: New Task…');
        await pickQuickItem(page, 'Ant build');
        await expect(page.locator('.quick-input-widget .monaco-list-row', { hasText: 'modules' })).toBeVisible();
        await pickQuickItem(page, 'build.xml', '');
        const editor = await webview(page, '#targetList');

        await editor.locator('#taskName').fill('Build'); // already used in this folder
        await editor.locator('.target-row[data-name="dist"]').click(); // deselect the default target
        await editor.locator('#saveTaskBtn').click();
        await expect(editor.locator('#taskNameError')).toBeVisible();
        await expect(editor.locator('#targetsError')).toBeVisible();

        await editor.locator('#taskName').fill('Unique name');
        await expect(editor.locator('#taskNameError')).toBeHidden();
        await editor.locator('.target-row[data-name="test"]').click();
        await expect(editor.locator('#targetsError')).toBeHidden();
    });

    test('edits an existing task in place, keeping its arguments', async ({ vscode }) => {
        const { page, workspace } = vscode;
        await runCommand(page, 'Task Studio: Edit Task…');
        await pickQuickItem(page, 'Build');
        const editor = await webview(page, '#targetList');
        await expect(editor.locator('#taskName')).toHaveValue('Build');
        // -Denv=dev is shown as a property row, not as free text
        await expect(editor.locator('.prop-key')).toHaveValue('env');
        await expect(editor.locator('.prop-value')).toHaveValue('dev');

        await editor.locator('#taskName').fill('Build all');
        await editor.locator('.target-row[data-name="javadoc"]').click();
        await editor.locator('#saveTaskBtn').click();

        await expect.poll(() => readTasks(workspace).tasks.map(t => t.label)).toEqual(['Build all', 'Report', 'Hello']);
        expect(readTasks(workspace).tasks[0].args).toEqual(['-f', '${workspaceFolder}/build.xml', '-Denv=dev', 'clean', 'dist', 'javadoc']);
    });
});

test.describe('Script task editor', () => {
    test('creates a Python task that works on Linux and Windows', async ({ vscode }) => {
        const { page, workspace } = vscode;
        await runCommand(page, 'Task Studio: New Task…');
        await pickQuickItem(page, 'Python script');
        await pickQuickItem(page, 'report.py');

        const editor = await webview(page, '#scriptArgs');
        await expect(editor.locator('#taskName')).toHaveValue('Python: report.py');
        await expect(editor.locator('#interpreter')).toHaveValue(process.platform === 'win32' ? 'python' : 'python3');
        await editor.locator('#scriptArgs').fill('--month\n12');
        await expect(editor.locator('#commandPreview')).toContainText('report.py --month 12');
        await editor.locator('#saveTaskBtn').click();

        await expect.poll(() => readTasks(workspace).tasks.length).toBe(4);
        const task = readTasks(workspace).tasks[3];
        expect(task).toMatchObject({
            label: 'Python: report.py',
            type: 'process',
            command: 'python3',
            windows: { command: 'python' },
            args: ['-u', '${workspaceFolder}/scripts/report.py', '--month', '12'],
            taskManager: { kind: 'python', scriptArgs: ['--month', '12'] }
        });
    });

    test('creates a custom shell command and runs it with Save & Run', async ({ vscode }) => {
        const { page, workspace } = vscode;
        await runCommand(page, 'Task Studio: New Task…');
        await pickQuickItem(page, 'Custom command');

        const editor = await webview(page, '#command');
        await editor.locator('#taskName').fill('Write marker');
        await editor.locator('#command').fill('echo done > marker.txt');
        await editor.locator('#saveRunBtn').click();

        await expect.poll(() => fs.existsSync(path.join(workspace, 'marker.txt')), { timeout: 20_000 }).toBe(true);
        expect(readTasks(workspace).tasks.at(-1)).toMatchObject({ label: 'Write marker', type: 'shell', command: 'echo done > marker.txt' });
    });

    test('requires a command for custom tasks', async ({ vscode }) => {
        const { page } = vscode;
        await runCommand(page, 'Task Studio: New Task…');
        await pickQuickItem(page, 'Custom command');
        const editor = await webview(page, '#command');
        await editor.locator('#saveTaskBtn').click();
        await expect(editor.locator('#commandError')).toBeVisible();
    });
});
