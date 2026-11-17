/**
 * Creates each kind of script task through the UI and runs it with Save & Run, on the OS the
 * tests run on. Kinds that cannot run here are skipped: Batch only on Windows, shell scripts
 * only on Linux/macOS, PowerShell on Windows or wherever pwsh is installed, Python wherever it
 * is on PATH. The fixture scripts write their arguments to "<kind>.out" in the workspace.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, pickQuickItem, readTasks, runCommand, test, webview } from './vscode';

const isWindows = process.platform === 'win32';

function onPath(command: string, versionArg = '--version'): boolean {
    return spawnSync(command, [versionArg], { stdio: 'ignore', timeout: 30_000 }).status === 0;
}

function readOutput(file: string): string {
    if (!fs.existsSync(file)) { return ''; }
    const bytes = fs.readFileSync(file);
    const utf16 = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE;
    return (utf16 ? bytes.toString('utf16le') : bytes.toString('utf8')).replace(/^﻿/, '').trim();
}

interface Case {
    kind: string;
    /** Entry in the "New Task" quick pick. */
    pick: string;
    file: string;
    interpreter: string;
    expected: string;
    skip?: string;
}

const CASES: Case[] = [
    {
        kind: 'batch', pick: 'Batch script', file: 'build.bat', interpreter: 'cmd.exe',
        expected: 'Building prod eu', skip: isWindows ? undefined : 'Batch scripts run only on Windows'
    },
    {
        kind: 'powershell', pick: 'PowerShell script', file: 'deploy.ps1', interpreter: isWindows ? 'powershell.exe' : 'pwsh',
        expected: 'Deploying to prod eu', skip: isWindows || onPath('pwsh', '-Version') ? undefined : 'pwsh is not installed'
    },
    {
        kind: 'bash', pick: 'Shell script', file: 'deploy.sh', interpreter: 'bash',
        expected: 'Deploying to prod eu', skip: isWindows ? 'Shell scripts are not tested on Windows' : undefined
    },
    {
        kind: 'python', pick: 'Python script', file: 'report.py', interpreter: isWindows ? 'python' : 'python3',
        expected: 'Report for prod eu', skip: onPath(isWindows ? 'python' : 'python3') ? undefined : 'Python is not on PATH'
    },
    {
        kind: 'node', pick: 'Node.js script', file: 'hello.js', interpreter: 'node',
        expected: 'hello from node prod eu'
    }
];

test.describe(`Script tasks on ${process.platform}`, () => {
    for (const c of CASES) {
        test(`${c.pick}: create with the editor, then Save & Run`, async ({ vscode }) => {
            test.skip(!!c.skip, c.skip);
            const { page, workspace } = vscode;
            const out = path.join(workspace, `${c.kind}.out`);

            await runCommand(page, 'Task Studio: New Task…');
            await pickQuickItem(page, c.pick);
            await pickQuickItem(page, c.file);

            const editor = await webview(page, '#scriptArgs');
            await expect(editor.locator('#interpreter')).toHaveValue(c.interpreter);
            // One argument per line: the space must reach the script as part of the argument.
            await editor.locator('#scriptArgs').fill('prod eu');
            await expect(editor.locator('#commandPreview')).toContainText(c.file);
            await editor.locator('#saveRunBtn').click();

            await expect.poll(() => readOutput(out), { timeout: 30_000 }).toBe(c.expected);
            const saved = readTasks(workspace).tasks.at(-1);
            expect(saved.taskManager).toMatchObject({ kind: c.kind, scriptArgs: ['prod eu'] });
        });
    }
});
