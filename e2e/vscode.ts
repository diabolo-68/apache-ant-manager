/**
 * Playwright fixtures that launch a real VS Code (downloaded by @vscode/test-electron into
 * .vscode-test/) with this extension loaded in development mode, on a throw-away copy of
 * test-fixtures/workspace. Works the same on Linux, macOS and Windows.
 */
import { _electron as electron, test as base, expect, type ElectronApplication, type Frame, type Locator, type Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'test-fixtures', 'workspace');

/** Settings that keep the window quiet and deterministic (no welcome page, chat, tips, updates…). */
const USER_SETTINGS = {
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.tips.enabled': false,
    'workbench.enableExperiments': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'workbench.layoutControl.enabled': false,
    'window.commandCenter': false,
    'window.titleBarStyle': 'custom',
    'window.restoreWindows': 'none',
    'window.zoomLevel': 0,
    'chat.disableAIFeatures': true,
    'chat.commandCenter.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.ignoreRecommendations': true,
    'security.workspace.trust.enabled': false,
    'git.enabled': false,
    'git.openRepositoryInParentFolders': 'never',
    'terminal.integrated.enablePersistentSessions': false,
    'editor.minimap.enabled': false,
    'explorer.autoReveal': false
};

let vscodePath: Promise<string> | undefined;
function vscodeExecutable(): Promise<string> {
    vscodePath ??= downloadAndUnzipVSCode({
        version: process.env.VSCODE_VERSION || 'stable',
        cachePath: path.join(ROOT, '.vscode-test')
    });
    return vscodePath;
}

/**
 * Environment for the VS Code under test. Variables inherited from a parent VS Code (when the
 * tests are started from its integrated terminal) would make the child run as plain Node
 * (ELECTRON_RUN_AS_NODE) or attach to the parent instance (VSCODE_IPC_HOOK…), so drop them.
 */
function cleanEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined || /^(ELECTRON_|VSCODE_)/i.test(key)) { continue; }
        env[key] = value;
    }
    return env;
}

export interface VSCode {
    app: ElectronApplication;
    page: Page;
    /** Absolute path of the temporary workspace folder. */
    workspace: string;
}

export const test = base.extend<{ vscode: VSCode; workspaceDir: string }>({
    workspaceDir: async ({}, use) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-manager-e2e-'));
        const workspace = path.join(dir, 'sample-project');
        fs.cpSync(FIXTURE, workspace, { recursive: true });
        await use(workspace);
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    },

    vscode: async ({ workspaceDir }, use, testInfo) => {
        const profile = path.join(path.dirname(workspaceDir), 'profile');
        fs.mkdirSync(path.join(profile, 'user', 'User'), { recursive: true });
        fs.writeFileSync(path.join(profile, 'user', 'User', 'settings.json'), JSON.stringify(USER_SETTINGS, null, 2));

        const app = await electron.launch({
            executablePath: await vscodeExecutable(),
            args: [
                workspaceDir,
                `--extensionDevelopmentPath=${ROOT}`,
                `--user-data-dir=${path.join(profile, 'user')}`,
                `--extensions-dir=${path.join(profile, 'extensions')}`,
                '--disable-workspace-trust',
                '--skip-welcome',
                '--skip-release-notes',
                '--disable-telemetry',
                '--disable-updates',
                '--new-window',
                ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu-sandbox'] : [])
            ],
            env: cleanEnv()
        });
        const page = await app.firstWindow();
        await app.evaluate(({ BrowserWindow }) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.setSize(1280, 800);
            win.center();
        });
        await page.locator('.monaco-workbench').waitFor();
        // The extension is ready once its Explorer view is registered.
        await page.locator('.explorer-folders-view, .explorer-viewlet').first().waitFor();

        await use({ app, page, workspace: workspaceDir });

        if (testInfo.status !== testInfo.expectedStatus) {
            await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined);
        }
        await app.close();
    }
});

export { expect };

// ---------------------------------------------------------------------------------------------
// Helpers for driving the workbench
// ---------------------------------------------------------------------------------------------

const quickInput = (page: Page) => page.locator('.quick-input-widget input');
const focusedRow = (page: Page) => page.locator('.quick-input-widget .monaco-list-row.focused');

/**
 * Accept the quick pick entry matching `label` after filtering with `filter`. Waits until that
 * entry is the focused one and presses Enter: clicking can hit the wrong row while the list
 * is still re-rendering after the filter changed.
 */
async function acceptQuickPick(page: Page, filter: string, label: string | RegExp): Promise<void> {
    const input = quickInput(page);
    await expect(input).toBeVisible();
    await input.fill(filter);
    await expect(focusedRow(page)).toContainText(label);
    await input.press('Enter');
}

/** Run a command from the command palette by its title (e.g. "Task Manager: New Task…"). */
export async function runCommand(page: Page, title: string): Promise<void> {
    await expect(async () => {
        // Focus can be left inside a webview that was just closed; key presses would then go
        // nowhere. Return focus to the workbench document first.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('F1');
        await expect(quickInput(page)).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15_000 });
    await acceptQuickPick(page, '>' + title, title);
}

/**
 * Pick an entry in the open quick pick. `filter` (default: the label) is typed into the box;
 * the first matching entry must be the one wanted.
 */
export async function pickQuickItem(page: Page, label: string, filter = label): Promise<void> {
    // Wait for asynchronously loaded items (e.g. the file list) before filtering.
    await expect(page.locator('.quick-input-widget .monaco-list-row').filter({ hasText: label }).first()).toBeVisible();
    await acceptQuickPick(page, filter, label);
}

/** The "Task Manager" view in the Explorer, opened, expanded and focused. */
export async function taskView(page: Page): Promise<Locator> {
    await runCommand(page, 'Explorer: Focus on Task Manager View');
    const header = page.locator('.pane-header', { hasText: 'Task Manager' });
    await expect(header).toBeVisible();
    if (await header.getAttribute('aria-expanded') !== 'true') {
        await header.click();
    }
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    const pane = page.locator('.pane', { has: header });
    await expect(pane.locator('.pane-body')).toBeVisible();
    return pane;
}

/** A row of a tree view, matched by its label. */
export function treeItem(container: Locator, label: string): Locator {
    return container.locator('.monaco-list-row').filter({
        has: container.page().locator('.label-name', { hasText: new RegExp(`^${escapeRegExp(label)}$`) })
    });
}

/**
 * The inner frame of the visible webview that contains `selector`.
 * VS Code nests each webview as iframe.webview > iframe#active-frame.
 */
export async function webview(page: Page, selector: string, timeout = 20000): Promise<Frame> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        for (const frame of page.frames()) {
            if (frame === page.mainFrame() || frame.isDetached()) { continue; }
            try {
                if (await frame.locator(selector).first().isVisible()) { return frame; }
            } catch {
                // frame navigated away while probing
            }
        }
        await page.waitForTimeout(200);
    }
    throw new Error(`No visible webview contains ${selector}`);
}

/** Read the workspace's .vscode/tasks.json (JSON with comments). */
export function readTasks(workspace: string): { text: string; tasks: any[] } {
    const text = fs.readFileSync(path.join(workspace, '.vscode', 'tasks.json'), 'utf8');
    const jsonc = require('jsonc-parser') as typeof import('jsonc-parser');
    return { text, tasks: jsonc.parse(text).tasks };
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
