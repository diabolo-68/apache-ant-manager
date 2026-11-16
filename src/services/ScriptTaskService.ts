import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AntTaskConfig, AntTaskService } from './AntTaskService';
import { SCRIPT_KINDS, ScriptKind, ScriptTaskSpec, TaskManagerMeta } from '../types/taskKinds';

const isWindows = process.platform === 'win32';

/**
 * Converts between the script task editor's model (ScriptTaskSpec) and tasks.json entries,
 * and runs specs directly.
 */
export class ScriptTaskService {
    constructor(private readonly _taskService: AntTaskService) {}

    /** Default spec for a new task of the given kind, optionally for a given script file. */
    defaultSpec(kind: ScriptKind, scriptPath?: string): ScriptTaskSpec {
        const info = SCRIPT_KINDS[kind];
        const baseName = scriptPath ? path.basename(scriptPath) : '';
        return {
            kind,
            label: baseName ? `${info.shortLabel}: ${baseName}` : (kind === 'custom' ? 'My command' : `${info.shortLabel} task`),
            interpreter: info.defaultInterpreter(isWindows),
            interpreterArgs: info.defaultInterpreterArgs(isWindows),
            script: scriptPath ?? '',
            scriptArgs: [],
            useShell: kind === 'custom',
            cwd: '',
            env: {},
            group: 'none',
            reveal: 'always',
            panel: 'dedicated',
            clear: false
        };
    }

    /** Rebuild the editor model from a stored task. */
    specFromTask(task: AntTaskConfig): ScriptTaskSpec {
        const meta = task.taskManager as TaskManagerMeta;
        const groupKind = typeof task.group === 'string' ? task.group : task.group?.kind;
        const reveal = task.presentation?.reveal;
        const panel = task.presentation?.panel;
        // Batch tasks are stored as shell tasks running cmd.exe (see toTaskConfig).
        const interpreter = meta.kind === 'batch'
            ? (task.options?.shell?.executable || 'cmd.exe')
            : (task.command || '');
        return {
            kind: meta.kind,
            label: task.label,
            interpreter,
            interpreterArgs: meta.interpreterArgs ?? [],
            script: meta.script ?? '',
            scriptArgs: meta.scriptArgs ?? [],
            useShell: !!meta.useShell,
            cwd: task.options?.cwd ?? '',
            env: { ...(task.options?.env ?? {}) },
            group: groupKind === 'build' || groupKind === 'test' ? groupKind : 'none',
            reveal: reveal === 'silent' || reveal === 'never' ? reveal : 'always',
            panel: panel === 'shared' || panel === 'new' ? panel : 'dedicated',
            clear: !!task.presentation?.clear
        };
    }

    private _rel(p: string): string {
        if (!p || p.includes('${')) { return p; }
        // Only absolute paths can be made workspace-relative; leave bare commands like "python3" alone.
        return path.isAbsolute(p) ? this._taskService.toWorkspaceRelativePath(p) : p;
    }

    /** Build the tasks.json entry for a spec. */
    toTaskConfig(spec: ScriptTaskSpec): AntTaskConfig {
        const info = SCRIPT_KINDS[spec.kind];
        const isCustom = spec.kind === 'custom';
        let script = isCustom ? '' : this._rel(spec.script);
        if (spec.kind === 'batch') {
            // cmd.exe treats "/" as a switch character, so batch paths need backslashes.
            script = script.replace(/\//g, '\\');
        }
        const interpreter = this._rel(spec.interpreter.trim());
        const useShell = isCustom && spec.useShell;

        const args = isCustom
            ? [...spec.scriptArgs]
            : [...spec.interpreterArgs, script, ...spec.scriptArgs];

        const meta: TaskManagerMeta = {
            kind: spec.kind,
            interpreterArgs: isCustom ? [] : [...spec.interpreterArgs],
            script,
            scriptArgs: [...spec.scriptArgs]
        };
        if (isCustom) { meta.useShell = useShell; }

        const config: AntTaskConfig = {
            label: spec.label,
            type: useShell ? 'shell' : 'process',
            command: interpreter,
            args,
            problemMatcher: [],
            presentation: { reveal: spec.reveal, panel: spec.panel, clear: spec.clear },
            taskManager: meta
        };
        if (spec.kind === 'batch') {
            // cmd.exe's /c quote handling breaks with process tasks when paths contain spaces;
            // VS Code's shell tasks quote correctly for cmd, so run the script as a shell command.
            config.type = 'shell';
            config.command = script;
            config.args = [...spec.scriptArgs];
            config.options = { shell: { executable: interpreter || 'cmd.exe', args: [...spec.interpreterArgs] } };
        }
        (config as any).detail = isCustom
            ? `${info.label}`
            : `${info.shortLabel} · ${script.replace(/^\$\{workspaceFolder(?::[^}]+)?\}[\\/]?/, '')}`;

        const env = Object.fromEntries(Object.entries(spec.env).filter(([k]) => k.trim() !== ''));
        if (spec.cwd || Object.keys(env).length) {
            config.options ??= {};
            if (spec.cwd) { config.options.cwd = this._rel(spec.cwd); }
            if (Object.keys(env).length) { config.options.env = env; }
        }
        if (spec.group !== 'none') {
            config.group = { kind: spec.group, isDefault: false };
        }
        return config;
    }

    /**
     * Run a spec immediately (used by "Save & Run", before VS Code has reloaded tasks.json).
     */
    async run(spec: ScriptTaskSpec, folder?: vscode.WorkspaceFolder): Promise<void> {
        const resolve = (p: string) => this._taskService.resolveWorkspacePath(p);
        const options = {
            cwd: spec.cwd ? resolve(spec.cwd) : folder?.uri.fsPath,
            env: Object.keys(spec.env).length ? spec.env : undefined
        };

        let execution: vscode.ProcessExecution | vscode.ShellExecution;
        if (spec.kind === 'batch') {
            execution = new vscode.ShellExecution(resolve(spec.script).replace(/\//g, '\\'), spec.scriptArgs.map(resolve), {
                ...options,
                executable: resolve(spec.interpreter) || 'cmd.exe',
                shellArgs: spec.interpreterArgs
            });
        } else if (spec.kind === 'custom') {
            execution = spec.useShell
                ? new vscode.ShellExecution(resolve(spec.interpreter), spec.scriptArgs.map(resolve), options)
                : new vscode.ProcessExecution(resolve(spec.interpreter), spec.scriptArgs.map(resolve), options);
        } else {
            execution = new vscode.ProcessExecution(
                resolve(spec.interpreter),
                [...spec.interpreterArgs, resolve(spec.script), ...spec.scriptArgs.map(resolve)],
                options
            );
        }

        const task = new vscode.Task(
            { type: execution instanceof vscode.ShellExecution ? 'shell' : 'process' },
            folder ?? vscode.TaskScope.Workspace,
            spec.label,
            'Task Manager',
            execution,
            []
        );
        task.presentationOptions = {
            reveal: spec.reveal === 'never' ? vscode.TaskRevealKind.Never
                : spec.reveal === 'silent' ? vscode.TaskRevealKind.Silent : vscode.TaskRevealKind.Always,
            panel: spec.panel === 'shared' ? vscode.TaskPanelKind.Shared
                : spec.panel === 'new' ? vscode.TaskPanelKind.New : vscode.TaskPanelKind.Dedicated,
            clear: spec.clear
        };
        await vscode.tasks.executeTask(task);
    }

    /**
     * Interpreter suggestions for the editor (shown in a dropdown on the interpreter field).
     * For Python, includes virtual environments found in the workspace and the Python extension's setting.
     */
    interpreterSuggestions(kind: ScriptKind, folder?: vscode.WorkspaceFolder): string[] {
        const fixed: Record<ScriptKind, string[]> = {
            bash: ['bash', 'sh', 'zsh', 'dash'],
            batch: ['cmd.exe'],
            powershell: ['pwsh', 'powershell.exe'],
            python: isWindows ? ['python', 'py', 'python3'] : ['python3', 'python'],
            node: ['node', 'bun', 'deno'],
            custom: ['make', 'gradle', 'mvn', 'npm', 'docker']
        };
        const out = new Set<string>();
        if (kind === 'python') {
            const configured = vscode.workspace.getConfiguration('python', folder?.uri).get<string>('defaultInterpreterPath');
            if (configured && configured !== 'python') { out.add(configured); }
            const roots = folder ? [folder] : (vscode.workspace.workspaceFolders ?? []);
            for (const root of roots) {
                for (const venv of ['.venv', 'venv', 'env']) {
                    const candidates = isWindows
                        ? [path.join(root.uri.fsPath, venv, 'Scripts', 'python.exe')]
                        : [path.join(root.uri.fsPath, venv, 'bin', 'python')];
                    for (const c of candidates) {
                        if (fs.existsSync(c)) { out.add(this._rel(c)); }
                    }
                }
            }
        }
        fixed[kind].forEach(s => out.add(s));
        return [...out];
    }
}
