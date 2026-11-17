import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { AntTaskService, parseJsonc, quoteArg, splitArgs, toStoredTask } from '../../services/AntTaskService';
import * as vscode from './vscodeStub';
import { cleanup, readJson, tempDir, write } from './helpers';

suite('AntTaskService', () => {
    let root: string;
    let app: string;
    let lib: string;
    let service: AntTaskService;

    setup(() => {
        root = tempDir();
        app = path.join(root, 'app');
        lib = path.join(root, 'app-lib'); // shares a prefix with "app" on purpose
        fs.mkdirSync(app);
        fs.mkdirSync(lib);
        vscode.reset([app]);
        service = new AntTaskService();
    });

    teardown(() => cleanup(root));

    suite('workspace-relative paths', () => {
        test('single folder uses ${workspaceFolder}', () => {
            assert.strictEqual(service.toWorkspaceRelativePath(path.join(app, 'sub', 'build.xml')), '${workspaceFolder}/sub/build.xml');
            assert.strictEqual(service.toWorkspaceRelativePath(app), '${workspaceFolder}');
        });

        test('multi-root uses ${workspaceFolder:NAME}', () => {
            vscode.reset([app, lib]);
            assert.strictEqual(service.toWorkspaceRelativePath(path.join(lib, 'build.xml')), '${workspaceFolder:app-lib}/build.xml');
            assert.strictEqual(service.toWorkspaceRelativePath(path.join(app, 'build.xml')), '${workspaceFolder:app}/build.xml');
        });

        test('a folder sharing a name prefix is not treated as inside', () => {
            // /tmp/x/app-lib must not become ${workspaceFolder}-lib
            const outside = path.join(lib, 'build.xml');
            assert.strictEqual(service.toWorkspaceRelativePath(outside), outside);
            assert.strictEqual(service.getWorkspaceFolderForFile(outside)?.name, 'app'); // fallback = first folder
        });

        test('paths outside every folder are kept absolute', () => {
            const outside = path.join(root, 'elsewhere.xml');
            assert.strictEqual(service.toWorkspaceRelativePath(outside), outside);
        });

        test('resolveWorkspacePath reverses toWorkspaceRelativePath', () => {
            vscode.reset([app, lib]);
            for (const p of [path.join(app, 'a', 'b.xml'), path.join(lib, 'c.xml')]) {
                assert.strictEqual(service.resolveWorkspacePath(service.toWorkspaceRelativePath(p)), p);
            }
            assert.strictEqual(service.resolveWorkspacePath('ant'), 'ant');
        });

        test('getWorkspaceFolderForFile picks the containing folder', () => {
            vscode.reset([app, lib]);
            assert.strictEqual(service.getWorkspaceFolderForFile(path.join(lib, 'x', 'build.xml'))?.name, 'app-lib');
        });
    });

    suite('generateTaskConfig / parseAntTask', () => {
        test('round-trips build file, targets and arguments', () => {
            const buildFile = path.join(app, 'build.xml');
            const cfg = service.generateTaskConfig(buildFile, ['clean', 'dist'], 'Build', '-Dprofile=prod\n-verbose "-Dmsg=hello world"');
            assert.strictEqual(cfg.type, 'shell');
            assert.strictEqual(cfg.command, 'ant');
            assert.deepStrictEqual(cfg.args, ['-f', '${workspaceFolder}/build.xml', '-Dprofile=prod', '-verbose', '-Dmsg=hello world', 'clean', 'dist']);
            assert.strictEqual(cfg.options?.cwd, '${workspaceFolder}');

            const parsed = service.parseAntTask(cfg);
            assert.deepStrictEqual(parsed.targets, ['clean', 'dist']);
            assert.strictEqual(parsed.rawBuildFile, '${workspaceFolder}/build.xml');
            assert.strictEqual(parsed.buildFile, buildFile);
            assert.strictEqual(parsed.additionalArgs, '-Dprofile=prod\n-verbose\n-Dmsg="hello world"');
        });

        test('ANT_HOME / JAVA_HOME extend PATH with the platform delimiter', () => {
            const cfg = service.generateTaskConfig(path.join(app, 'build.xml'), ['all'], 'B', '', undefined, '/opt/ant', '/opt/jdk');
            const sep = process.platform === 'win32' ? ';' : ':';
            assert.strictEqual(cfg.command, path.join('/opt/ant', 'bin', 'ant'));
            assert.strictEqual(cfg.options?.env?.ANT_HOME, '/opt/ant');
            assert.strictEqual(cfg.options?.env?.PATH,
                [path.join('/opt/jdk', 'bin'), path.join('/opt/ant', 'bin')].join(sep) + sep + '${env:PATH}');
            const parsed = service.parseAntTask(cfg);
            assert.strictEqual(parsed.antHome, '/opt/ant');
            assert.strictEqual(parsed.javaHome, '/opt/jdk');
        });

        test('shell choice is stored and detected', () => {
            for (const shell of ['powershell', 'cmd', 'bash', 'wsl']) {
                const cfg = service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'B', '', undefined, undefined, undefined, shell);
                assert.ok(cfg.options?.shell?.executable, shell);
                assert.strictEqual(service.parseAntTask(cfg).shell, shell);
            }
            const plain = service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'B');
            assert.strictEqual(plain.options?.shell, undefined);
            assert.strictEqual(service.parseAntTask(plain).shell, 'default');
        });

        test('kindOf / isScriptTask tell Ant and script tasks apart', () => {
            const ant = service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'B');
            assert.strictEqual(service.kindOf(ant), 'ant');
            assert.strictEqual(service.isScriptTask(ant), false);
            const script = { label: 'S', type: 'process', command: 'python3', args: ['x.py'], taskManager: { kind: 'python', interpreterArgs: [], script: 'x.py', scriptArgs: [] } } as any;
            assert.strictEqual(service.kindOf(script), 'python');
            assert.strictEqual(service.isScriptTask(script), true);
        });

        test('effectiveCommand honours platform overrides', () => {
            const t = { label: 'P', type: 'process', command: 'python3', args: [], windows: { command: 'python' } } as any;
            assert.strictEqual(service.effectiveCommand(t, 'win32'), 'python');
            assert.strictEqual(service.effectiveCommand(t, 'linux'), 'python3');
            assert.strictEqual(service.effectiveCommand(t, 'darwin'), 'python3');
        });
    });

    test('splitArgs / quoteArg behave like a shell and round-trip', () => {
        assert.deepStrictEqual(splitArgs(`-a "b c" 'd e' -Dx="1 2" f"g h"i`), ['-a', 'b c', 'd e', '-Dx=1 2', 'fg hi']);
        assert.strictEqual(quoteArg('-Dx=1 2'), '-Dx="1 2"');
        assert.strictEqual(quoteArg('two words'), '"two words"');
        assert.strictEqual(quoteArg('-q'), '-q');
        for (const arg of ['-Dx=1 2', 'two words', '-q']) {
            assert.deepStrictEqual(splitArgs(quoteArg(arg)), [arg]);
        }
    });

    suite('tasks.json persistence', () => {
        const tasksJson = () => path.join(app, '.vscode', 'tasks.json');

        test('creates .vscode/tasks.json and strips editor-only fields', async () => {
            const cfg = service.generateTaskConfig(path.join(app, 'build.xml'), ['compile'], 'Compile');
            await service.saveTaskToWorkspace(cfg);
            const saved = readJson(tasksJson());
            assert.strictEqual(saved.version, '2.0.0');
            assert.strictEqual(saved.tasks.length, 1);
            assert.strictEqual(saved.tasks[0].label, 'Compile');
            for (const key of ['workingDirectory', 'antHome', 'javaHome', 'shell', 'additionalArgs']) {
                assert.ok(!(key in saved.tasks[0]), `${key} must not be persisted`);
            }
        });

        test('keeps comments and unrelated tasks (JSONC)', async () => {
            write(tasksJson(), `// Top comment\n{\n    "version": "2.0.0",\n    // keep me\n    "tasks": [\n        { "label": "npm build", "type": "npm", "script": "build" }, // trailing\n    ],\n}\n`);
            await service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'Ant A'));
            const text = fs.readFileSync(tasksJson(), 'utf8');
            assert.ok(text.includes('// Top comment'));
            assert.ok(text.includes('// keep me'));
            const parsed = parseJsonc(text, 'tasks.json');
            assert.deepStrictEqual(parsed.tasks.map((t: any) => t.label), ['npm build', 'Ant A']);
            // Only Ant/managed tasks are listed
            assert.deepStrictEqual(service.getManagedTasks().map(t => t.label), ['Ant A']);
        });

        test('preserves CRLF line endings of an existing file', async () => {
            write(tasksJson(), '{\r\n    "version": "2.0.0",\r\n    "tasks": []\r\n}\r\n');
            await service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'A'));
            const text = fs.readFileSync(tasksJson(), 'utf8');
            assert.ok(!/[^\r]\n/.test(text), 'all newlines should stay CRLF');
        });

        test('refuses to overwrite a tasks.json it cannot parse', async () => {
            const broken = '{ "version": "2.0.0", "tasks": [ { "label": "x" ';
            write(tasksJson(), broken);
            await assert.rejects(
                service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'A')),
                /Cannot parse/);
            assert.strictEqual(fs.readFileSync(tasksJson(), 'utf8'), broken);
            assert.deepStrictEqual(service.getManagedTasks(), [], 'listing a broken file must not throw');
        });

        test('updateTask renames in place and can move between folders', async () => {
            vscode.reset([app, lib]);
            const [appFolder, libFolder] = vscode.state.folders;
            await service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'Old'), appFolder as any);

            await service.updateTask('Old', service.generateTaskConfig(path.join(app, 'build.xml'), ['b'], 'New'), appFolder as any, appFolder as any);
            assert.deepStrictEqual(readJson(tasksJson()).tasks.map((t: any) => t.label), ['New']);

            await service.updateTask('New', service.generateTaskConfig(path.join(app, 'build.xml'), ['b'], 'New'), libFolder as any, appFolder as any);
            assert.deepStrictEqual(readJson(tasksJson()).tasks, []);
            assert.deepStrictEqual(readJson(path.join(lib, '.vscode', 'tasks.json')).tasks.map((t: any) => t.label), ['New']);
        });

        test('updateTask keeps the task at its position', async () => {
            for (const label of ['A', 'B', 'C']) {
                await service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['t'], label));
            }
            const folder = vscode.state.folders[0] as any;
            await service.updateTask('B', service.generateTaskConfig(path.join(app, 'build.xml'), ['u'], 'B2'), folder, folder);
            assert.deepStrictEqual(readJson(tasksJson()).tasks.map((t: any) => t.label), ['A', 'B2', 'C']);
            await assert.rejects(service.updateTask('missing', service.generateTaskConfig(path.join(app, 'build.xml'), ['u'], 'X'), folder, folder), /not found/);
        });

        test('deleteTask removes only the matching task', async () => {
            await service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'A'));
            await service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['b'], 'B'));
            await service.deleteTask('A');
            assert.deepStrictEqual(readJson(tasksJson()).tasks.map((t: any) => t.label), ['B']);
            await assert.rejects(service.deleteTask('missing'), /not found/);
        });

        test('workspace-file tasks are read, written and tagged as workspace-level', async () => {
            const wsFile = write(path.join(root, 'all.code-workspace'),
                `{\n    // folders\n    "folders": [{ "path": "app" }, { "path": "app-lib" }],\n    "settings": { "editor.tabSize": 2 }\n}\n`);
            vscode.reset([app, lib], wsFile);
            assert.ok(service.isMultiRootWorkspace());
            await service.saveTaskToWorkspace(service.generateTaskConfig(path.join(app, 'build.xml'), ['a'], 'Shared'), undefined, true);

            const text = fs.readFileSync(wsFile, 'utf8');
            assert.ok(text.includes('// folders'), 'comments are preserved');
            const ws = parseJsonc(text, wsFile);
            assert.strictEqual(ws.settings['editor.tabSize'], 2);
            assert.deepStrictEqual(ws.tasks.tasks.map((t: any) => t.label), ['Shared']);

            const listed = service.getManagedTasks();
            assert.strictEqual(listed.length, 1);
            assert.strictEqual((listed[0] as any)._workspaceFolderName, '__workspace__');

            await service.deleteTask('Shared', '__workspace__');
            assert.deepStrictEqual(parseJsonc(fs.readFileSync(wsFile, 'utf8'), wsFile).tasks.tasks, []);
        });

        test('toStoredTask removes bookkeeping fields', () => {
            const stored = toStoredTask({ label: 'x', type: 'shell', command: 'ant', args: [], _workspaceFolder: {}, targets: ['a'] } as any);
            assert.deepStrictEqual(stored, { label: 'x', type: 'shell', command: 'ant', args: [] });
        });

        test('parseJsonc rejects non-object documents', () => {
            assert.throws(() => parseJsonc('[]', 'f'), /Cannot parse f/);
            assert.throws(() => parseJsonc('', 'f'), /Cannot parse f/);
        });
    });

    suite('running', () => {
        test('runSavedTask prefers the task in the requested folder', async () => {
            vscode.reset([app, lib]);
            const [appFolder, libFolder] = vscode.state.folders;
            const mk = (scope: any) => new vscode.Task({ type: 'shell' }, scope, 'Build', 'Workspace', new vscode.ShellExecution('ant', []), []);
            const inApp = mk(appFolder);
            const inLib = mk(libFolder);
            vscode.state.fetched = [inApp, inLib];
            assert.ok(await service.runSavedTask('Build', 'app-lib'));
            assert.strictEqual(vscode.state.executed[0], inLib);
            assert.strictEqual(await service.runSavedTask('Nope'), false);
            assert.strictEqual(vscode.state.messages.at(-1)?.level, 'error');
        });

        test('runAntTargets resolves workspace paths in the shell execution', async () => {
            await service.runAntTargets(path.join(app, 'build.xml'), ['test'], '-q');
            const task = vscode.state.executed[0];
            const exec = task.execution as vscode.ShellExecution;
            assert.strictEqual(exec.commandLine, 'ant');
            assert.deepStrictEqual(exec.args, ['-f', path.join(app, 'build.xml'), '-q', 'test']);
            assert.strictEqual(exec.options.cwd, app);
        });
    });
});
