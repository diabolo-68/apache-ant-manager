/**
 * Runs every kind of script task for real, on the OS the tests run on. A kind that cannot run
 * here is skipped with the reason: Batch only on Windows, shell scripts only on Linux/macOS,
 * PowerShell on Windows (powershell.exe) or wherever pwsh is installed, Python and Node.js
 * wherever their interpreter is on PATH.
 *
 * Each kind is tested twice, the way a user would use it:
 *  - saved:      spec → tasks.json (through the extension's services) → VS Code task → run
 *  - Save & Run: the spec runs directly, before VS Code has reloaded tasks.json
 *
 * The fixture scripts write their arguments to "<kind>.out" in the working directory. Both the
 * argument and the script's folder ("my scripts/") contain a space, so quoting is checked too.
 */
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AntTaskService } from '../../services/AntTaskService';
import { ScriptTaskService } from '../../services/ScriptTaskService';
import { ScriptKind, ScriptTaskSpec } from '../../types/taskKinds';

const isWindows = process.platform === 'win32';
const ARG = 'prod eu';

/** True if `command` can be started from PATH. */
function onPath(command: string, versionArg = '--version'): boolean {
    const result = spawnSync(command, [versionArg], { stdio: 'ignore', timeout: 30_000, shell: false });
    return result.status === 0;
}

interface Case {
    kind: ScriptKind;
    /** Script, relative to the workspace folder (empty for a custom command). */
    script: string;
    /** Text the script writes to <kind>.out. */
    expected: RegExp;
    /** Why this kind cannot run on this machine, or undefined if it can. */
    skip: () => string | undefined;
}

const CASES: Case[] = [
    {
        kind: 'batch', script: 'scripts/build.bat', expected: /^Building prod eu\s*$/,
        skip: () => isWindows ? undefined : 'Batch scripts run only on Windows'
    },
    {
        kind: 'powershell', script: 'scripts/deploy.ps1', expected: /^Deploying to prod eu\s*$/,
        skip: () => isWindows || onPath('pwsh', '-Version') ? undefined : 'pwsh is not installed'
    },
    {
        kind: 'bash', script: 'scripts/deploy.sh', expected: /^Deploying to prod eu\s*$/,
        skip: () => !isWindows ? undefined : 'Shell scripts are not tested on Windows'
    },
    {
        kind: 'python', script: 'scripts/report.py', expected: /^Report for prod eu\s*$/,
        skip: () => onPath(isWindows ? 'python' : 'python3') ? undefined : 'Python is not on PATH'
    },
    {
        kind: 'node', script: 'tools/hello.js', expected: /^hello from node prod eu\s*$/,
        skip: () => onPath('node') ? undefined : 'Node.js is not on PATH'
    }
];

function folder(): vscode.WorkspaceFolder {
    const f = vscode.workspace.workspaceFolders?.[0];
    assert.ok(f, 'the test workspace must be open');
    return f;
}

async function waitFor<T>(probe: () => T | undefined | Promise<T | undefined>, what: string, timeoutMs = 30_000): Promise<T> {
    const start = Date.now();
    for (;;) {
        const value = await probe();
        if (value) { return value; }
        if (Date.now() - start > timeoutMs) { throw new Error(`Timed out waiting for ${what}`); }
        await new Promise(r => setTimeout(r, 200));
    }
}

/** Resolves with the exit code of the next run of the task called `label`. */
function taskEnd(label: string): Promise<number | undefined> {
    return new Promise(resolve => {
        const sub = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution.task.name === label) { sub.dispose(); resolve(e.exitCode); }
        });
    });
}

/** Read <name> from the workspace, without BOM / UTF-16 noise. */
function readOutput(name: string): string | undefined {
    const file = path.join(folder().uri.fsPath, name);
    if (!fs.existsSync(file)) { return undefined; }
    const bytes = fs.readFileSync(file);
    // Windows PowerShell's ">" writes UTF-16 LE with a BOM.
    const utf16 = bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE;
    const text = (utf16 ? bytes.toString('utf16le') : bytes.toString('utf8')).replace(/^﻿/, '');
    return text || undefined; // the file can exist before it has been written
}

suite(`Script tasks run on ${process.platform}`, () => {
    const taskService = new AntTaskService();
    const scriptService = new ScriptTaskService(taskService);

    suiteSetup(async () => {
        await vscode.extensions.getExtension('diabolo-68.apache-ant-manager')!.activate();
    });

    /** Copy the fixture script into a folder whose name contains a space; return its path. */
    function scriptWithSpace(c: Case): string {
        const target = path.join(folder().uri.fsPath, 'my scripts', path.basename(c.script));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(folder().uri.fsPath, c.script), target);
        return target;
    }

    function spec(c: Case, label: string): ScriptTaskSpec {
        const s = scriptService.defaultSpec(c.kind, scriptWithSpace(c));
        s.label = label;
        s.scriptArgs = [ARG];
        s.reveal = 'silent';
        return s;
    }

    for (const c of CASES) {
        test(`${c.kind}: saved task runs with its arguments`, async function () {
            if (c.skip()) { this.skip(); }
            this.timeout(90_000);
            const out = `${c.kind}.out`;
            fs.rmSync(path.join(folder().uri.fsPath, out), { force: true });

            const label = `Saved ${c.kind}`;
            await taskService.saveTaskToWorkspace(scriptService.toTaskConfig(spec(c, label)), folder());
            const task = await waitFor(async () => (await vscode.tasks.fetchTasks()).find(t => t.name === label), `${label} in fetchTasks`);

            const ended = taskEnd(label);
            await vscode.tasks.executeTask(task);
            assert.strictEqual(await ended, 0, `${label} exit code`);
            assert.match(await waitFor(() => readOutput(out), out), c.expected);
        });

        test(`${c.kind}: Save & Run runs the spec directly`, async function () {
            if (c.skip()) { this.skip(); }
            this.timeout(90_000);
            const out = `${c.kind}.out`;
            fs.rmSync(path.join(folder().uri.fsPath, out), { force: true });

            const label = `Direct ${c.kind}`;
            const ended = taskEnd(label);
            await scriptService.run(spec(c, label), folder());
            assert.strictEqual(await ended, 0, `${label} exit code`);
            assert.match(await waitFor(() => readOutput(out), out), c.expected);
        });
    }

    test('custom command through the default shell', async function () {
        this.timeout(90_000);
        fs.rmSync(path.join(folder().uri.fsPath, 'custom.out'), { force: true });
        const s = scriptService.defaultSpec('custom');
        s.label = 'Custom shell';
        // Valid in bash, cmd.exe and PowerShell (the default shells on each OS).
        s.interpreter = 'echo custom > custom.out';
        s.reveal = 'silent';
        const ended = taskEnd(s.label);
        await scriptService.run(s, folder());
        assert.strictEqual(await ended, 0);
        assert.match(await waitFor(() => readOutput('custom.out'), 'custom.out'), /^custom\s*$/);
    });

    test('skipped kinds are reported (for the log)', function () {
        const skipped = CASES.map(c => [c.kind, c.skip()]).filter(([, r]) => r);
        for (const [kind, reason] of skipped) { console.log(`      - ${kind}: ${reason}`); }
    });
});
