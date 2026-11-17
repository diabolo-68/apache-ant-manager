/**
 * Regenerates the README screenshots and the animated GIF in docs/screenshots/ from the
 * sample workspace:
 *   npm run screenshots
 * Not part of the regular e2e run (separate Playwright project). The committed images were
 * taken on Windows; the GIF uses a PowerShell script there and a shell script elsewhere.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { GifRecorder } from './recorder';
import { expect, pickQuickItem, runCommand, taskView, test, treeItem, webview } from './vscode';

const OUT = path.resolve(__dirname, '..', 'docs', 'screenshots');

test.beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

async function settle(page: Page): Promise<void> {
    // Let hover/focus transitions and the webview fade-in finish.
    await page.mouse.move(1270, 790);
    await page.waitForTimeout(800);
}

async function collapseFileExplorer(page: Page): Promise<void> {
    const header = page.locator('.pane-header', { hasText: 'sample-project' });
    if (await header.getAttribute('aria-expanded') === 'true') { await header.click(); }
    for (const name of ['Outline', 'Timeline']) {
        const pane = page.locator('.pane-header', { hasText: name });
        if (await pane.count() && await pane.getAttribute('aria-expanded') === 'true') { await pane.click(); }
    }
}

test('overview: Explorer view and task list', async ({ vscode }) => {
    const { page } = vscode;
    await collapseFileExplorer(page);
    const view = await taskView(page);
    await treeItem(view, 'Build').click();
    await expect(treeItem(view, 'dist')).toBeVisible();

    await runCommand(page, 'Task Studio: Open Task Studio');
    await webview(page, '.task-row');
    await settle(page);
    await page.screenshot({ path: path.join(OUT, 'overview.png') });
    await page.locator('.part.sidebar').screenshot({ path: path.join(OUT, 'explorer-view.png') });
});

test('new task: choose a kind', async ({ vscode }) => {
    const { page } = vscode;
    await collapseFileExplorer(page);
    await taskView(page);
    await runCommand(page, 'Task Studio: New Task…');
    await expect(page.locator('.quick-input-widget .monaco-list-row', { hasText: 'Python script' })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, 'new-task.png') });
});

test('Ant task editor', async ({ vscode }) => {
    const { page } = vscode;
    await collapseFileExplorer(page);
    await taskView(page);
    await runCommand(page, 'Task Studio: Edit Task…');
    await pickQuickItem(page, 'Build');
    const editor = await webview(page, '#targetList');
    await editor.locator('.target-row[data-name="test"]').click();
    await settle(page);
    await page.screenshot({ path: path.join(OUT, 'ant-editor.png') });
});

test('script task editor', async ({ vscode }) => {
    const { page } = vscode;
    await collapseFileExplorer(page);
    await taskView(page);
    await runCommand(page, 'Task Studio: Edit Task…');
    await pickQuickItem(page, 'Report');
    await webview(page, '#scriptArgs');
    await settle(page);
    await page.screenshot({ path: path.join(OUT, 'script-editor.png') });
});

test('animated GIF: creating and running a task', async ({ vscode }) => {
    const { page, workspace } = vscode;
    const windows = process.platform === 'win32';
    const kind = windows ? { pick: 'PowerShell script', file: 'deploy.ps1', out: 'powershell.out' }
        : { pick: 'Shell script', file: 'deploy.sh', out: 'bash.out' };

    await collapseFileExplorer(page);
    const view = await taskView(page);
    await settle(page);

    const gif = new GifRecorder(page, { x: 700, y: 450 });
    gif.start();
    await gif.pause(1000);

    // + in the Task Studio view title
    await gif.moveTo(view.locator('.pane-header'));
    await gif.click(view.locator('.pane-header .action-label[aria-label^="New Task"]'));
    const row = (label: string) => page.locator('.quick-input-widget .monaco-list-row', { hasText: label });
    await expect(row('Python script')).toBeVisible();
    await gif.pause(900);
    await gif.click(row(kind.pick));
    await expect(row(kind.file)).toBeVisible();
    await gif.pause(700);
    await gif.click(row(kind.file));

    const editor = await webview(page, '#scriptArgs');
    await gif.pause(1200);
    await gif.type(editor.locator('#taskName'), 'Deploy to production', { clear: true });
    await gif.pause(300);
    await gif.type(editor.locator('#scriptArgs'), 'production');
    await gif.pause(500);
    await gif.moveTo(editor.locator('#commandPreview'));
    await gif.pause(1500);
    await gif.click(editor.locator('#saveRunBtn'));

    await expect.poll(() => fs.existsSync(path.join(workspace, kind.out)), { timeout: 30_000 }).toBe(true);
    await expect(treeItem(view, 'Deploy to production')).toBeVisible();
    await gif.moveTo(treeItem(view, 'Deploy to production'));
    await gif.pause(2500);
    await gif.save(path.join(OUT, 'create-task.gif'), { width: 960, holdLastMs: 3000 });
});
