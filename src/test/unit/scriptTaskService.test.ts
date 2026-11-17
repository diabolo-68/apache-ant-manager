import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AntTaskService } from '../../services/AntTaskService';
import { ScriptTaskService } from '../../services/ScriptTaskService';
import { SCRIPT_KIND_ORDER, SCRIPT_KINDS, ScriptKind, scriptKindForFile } from '../../types/taskKinds';
import * as vscode from './vscodeStub';
import { cleanup, tempDir } from './helpers';

const EXT: Record<Exclude<ScriptKind, 'custom'>, string> = { bash: 'sh', batch: 'bat', powershell: 'ps1', python: 'py', node: 'js' };

suite('ScriptTaskService', () => {
    let root: string;
    let ant: AntTaskService;

    setup(() => {
        root = tempDir();
        vscode.reset([root]);
        ant = new AntTaskService();
    });
    teardown(() => cleanup(root));

    for (const platform of ['linux', 'win32'] as NodeJS.Platform[]) {
        suite(`on ${platform}`, () => {
            for (const kind of SCRIPT_KIND_ORDER) {
                test(`${kind}: spec → tasks.json → spec round-trip`, () => {
                    const svc = new ScriptTaskService(ant, platform);
                    const scriptPath = kind === 'custom' ? undefined : path.join(root, 'scripts', `run me.${EXT[kind]}`);
                    const spec = svc.defaultSpec(kind, scriptPath);
                    spec.scriptArgs = ['--env', 'staging area'];
                    spec.env = { FOO: 'bar', '': 'ignored' };
                    spec.cwd = path.join(root, 'sub');
                    spec.group = 'test';
                    spec.reveal = 'silent';
                    spec.panel = 'shared';
                    spec.clear = true;
                    if (kind === 'custom') { spec.interpreter = 'make'; spec.useShell = true; }

                    const cfg = JSON.parse(JSON.stringify(svc.toTaskConfig(spec))); // as stored on disk
                    assert.ok(ant.isScriptTask(cfg));
                    assert.strictEqual(ant.kindOf(cfg), kind);
                    assert.deepStrictEqual(cfg.options.env, { FOO: 'bar' });
                    assert.strictEqual(cfg.options.cwd, '${workspaceFolder}/sub');
                    assert.deepStrictEqual(cfg.group, { kind: 'test', isDefault: false });

                    const back = svc.specFromTask(cfg);
                    let script = kind === 'custom' ? '' : '${workspaceFolder}/scripts/' + path.basename(scriptPath!);
                    if (kind === 'batch') { script = script.replace(/\//g, '\\'); }
                    assert.deepStrictEqual(back, { ...spec, env: { FOO: 'bar' }, script, cwd: '${workspaceFolder}/sub' });
                });
            }

            test('default interpreters are stored portably with a windows override', () => {
                const svc = new ScriptTaskService(ant, platform);
                for (const kind of ['python', 'powershell'] as ScriptKind[]) {
                    const cfg = svc.toTaskConfig(svc.defaultSpec(kind, path.join(root, `x.${EXT[kind as 'python']}`)));
                    assert.strictEqual(cfg.command, SCRIPT_KINDS[kind].defaultInterpreter(false), kind);
                    assert.deepStrictEqual(cfg.windows, { command: SCRIPT_KINDS[kind].defaultInterpreter(true) }, kind);
                    // ...and each platform reads back its own default
                    assert.strictEqual(svc.specFromTask(cfg).interpreter, SCRIPT_KINDS[kind].defaultInterpreter(platform === 'win32'));
                }
            });

            test('a custom interpreter is stored as-is without overrides', () => {
                const svc = new ScriptTaskService(ant, platform);
                const spec = svc.defaultSpec('python', path.join(root, 'x.py'));
                spec.interpreter = path.join(root, '.venv', 'bin', 'python');
                const cfg = svc.toTaskConfig(spec);
                assert.strictEqual(cfg.command, '${workspaceFolder}/.venv/bin/python');
                assert.strictEqual(cfg.windows, undefined);
                assert.strictEqual(svc.specFromTask(cfg).interpreter, '${workspaceFolder}/.venv/bin/python');
            });
        });
    }

    test('batch scripts run as cmd.exe shell tasks with backslash paths', () => {
        const svc = new ScriptTaskService(ant, 'win32');
        const cfg = svc.toTaskConfig(svc.defaultSpec('batch', path.join(root, 'tools', 'build.bat')));
        assert.strictEqual(cfg.type, 'shell');
        assert.strictEqual(cfg.command, '${workspaceFolder}\\tools\\build.bat');
        assert.deepStrictEqual(cfg.options?.shell, { executable: 'cmd.exe', args: ['/d', '/c'] });
    });

    test('process tasks put interpreter options before the script', () => {
        const svc = new ScriptTaskService(ant, 'linux');
        const spec = svc.defaultSpec('powershell', path.join(root, 'deploy.ps1'));
        spec.scriptArgs = ['-Stage', 'prod'];
        const cfg = svc.toTaskConfig(spec);
        assert.strictEqual(cfg.type, 'process');
        assert.deepStrictEqual(cfg.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${workspaceFolder}/deploy.ps1', '-Stage', 'prod']);
        assert.strictEqual((cfg as any).detail, 'PowerShell · deploy.ps1');
    });

    test('custom commands without shell are process tasks', () => {
        const svc = new ScriptTaskService(ant, 'linux');
        const spec = svc.defaultSpec('custom');
        spec.interpreter = 'docker';
        spec.useShell = false;
        spec.scriptArgs = ['compose', 'up'];
        const cfg = svc.toTaskConfig(spec);
        assert.strictEqual(cfg.type, 'process');
        assert.strictEqual(cfg.command, 'docker');
        assert.deepStrictEqual(cfg.args, ['compose', 'up']);
    });

    test('defaultSpec labels new tasks after the script', () => {
        const svc = new ScriptTaskService(ant, 'linux');
        assert.strictEqual(svc.defaultSpec('python', path.join(root, 'etl.py')).label, 'Python: etl.py');
        assert.strictEqual(svc.defaultSpec('custom').label, 'My command');
        assert.strictEqual(svc.defaultSpec('node').label, 'Node.js task');
    });

    test('run() executes the right kind of execution', async () => {
        const svc = new ScriptTaskService(ant, 'linux');
        const spec = svc.defaultSpec('python', path.join(root, 'a.py'));
        spec.scriptArgs = ['${workspaceFolder}/data.csv'];
        await svc.run(spec, vscode.state.folders[0] as any);
        const exec = vscode.state.executed[0].execution as vscode.ProcessExecution;
        assert.ok(exec instanceof vscode.ProcessExecution);
        assert.strictEqual(exec.process, 'python3');
        assert.deepStrictEqual(exec.args, ['-u', path.join(root, 'a.py'), path.join(root, 'data.csv')]);
        assert.strictEqual(exec.options.cwd, root);

        const shellSpec = svc.defaultSpec('custom');
        shellSpec.interpreter = 'make';
        await svc.run(shellSpec);
        assert.ok(vscode.state.executed[1].execution instanceof vscode.ShellExecution);
        assert.strictEqual(vscode.state.executed[1].presentationOptions.reveal, vscode.TaskRevealKind.Always);
    });

    test('interpreterSuggestions lists virtual environments first', () => {
        const linux = new ScriptTaskService(ant, 'linux');
        const venvPython = path.join(root, '.venv', 'bin', 'python');
        fs.mkdirSync(path.dirname(venvPython), { recursive: true });
        fs.writeFileSync(venvPython, '');
        const suggestions = linux.interpreterSuggestions('python', vscode.state.folders[0] as any);
        assert.strictEqual(suggestions[0], '${workspaceFolder}/.venv/bin/python');
        assert.ok(suggestions.includes('python3'));
        assert.ok(new ScriptTaskService(ant, 'win32').interpreterSuggestions('bash').some(s => s.includes('Git')));
    });
});

suite('taskKinds', () => {
    test('scriptKindForFile maps extensions case-insensitively', () => {
        assert.strictEqual(scriptKindForFile('deploy.SH'), 'bash');
        assert.strictEqual(scriptKindForFile('C:\\tools\\build.cmd'), 'batch');
        assert.strictEqual(scriptKindForFile('a.ps1'), 'powershell');
        assert.strictEqual(scriptKindForFile('main.py'), 'python');
        assert.strictEqual(scriptKindForFile('index.mjs'), 'node');
        assert.strictEqual(scriptKindForFile('README.md'), undefined);
        assert.strictEqual(scriptKindForFile('Makefile'), undefined);
    });

    test('every kind is registered and ordered', () => {
        assert.deepStrictEqual([...SCRIPT_KIND_ORDER].sort(), Object.keys(SCRIPT_KINDS).sort());
        for (const kind of SCRIPT_KIND_ORDER) {
            assert.strictEqual(SCRIPT_KINDS[kind].id, kind);
        }
    });
});
