/**
 * Kinds of tasks the extension can create and manage, besides Ant.
 * Each kind maps to a `process` (or `shell`) task in tasks.json.
 */
export type ScriptKind = 'bash' | 'batch' | 'powershell' | 'python' | 'node' | 'custom';
export type TaskKind = 'ant' | ScriptKind;

export interface ScriptKindInfo {
    id: ScriptKind;
    /** Human-readable name, e.g. "Python script". */
    label: string;
    /** Short name used in badges. */
    shortLabel: string;
    /** Codicon id. */
    icon: string;
    /** Script file extensions, lower-case without dot. Empty for "custom". */
    extensions: string[];
    /** Label for the interpreter field. */
    interpreterLabel: string;
    defaultInterpreter: (isWindows: boolean) => string;
    /** Interpreter options placed before the script path. */
    defaultInterpreterArgs: (isWindows: boolean) => string[];
    description: string;
}

export const SCRIPT_KINDS: Record<ScriptKind, ScriptKindInfo> = {
    bash: {
        id: 'bash',
        label: 'Shell script',
        shortLabel: 'Shell',
        icon: 'terminal-bash',
        extensions: ['sh', 'bash'],
        interpreterLabel: 'Shell',
        defaultInterpreter: () => 'bash',
        defaultInterpreterArgs: () => [],
        description: 'Run a .sh script with bash, sh, zsh, …'
    },
    batch: {
        id: 'batch',
        label: 'Batch script',
        shortLabel: 'Batch',
        icon: 'terminal-cmd',
        extensions: ['bat', 'cmd'],
        interpreterLabel: 'Command processor',
        defaultInterpreter: () => 'cmd.exe',
        defaultInterpreterArgs: () => ['/d', '/c'],
        description: 'Run a Windows .bat / .cmd file'
    },
    powershell: {
        id: 'powershell',
        label: 'PowerShell script',
        shortLabel: 'PowerShell',
        icon: 'terminal-powershell',
        extensions: ['ps1'],
        interpreterLabel: 'PowerShell',
        defaultInterpreter: (isWindows) => isWindows ? 'powershell.exe' : 'pwsh',
        defaultInterpreterArgs: () => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
        description: 'Run a .ps1 script with Windows PowerShell or pwsh'
    },
    python: {
        id: 'python',
        label: 'Python script',
        shortLabel: 'Python',
        icon: 'snake',
        extensions: ['py'],
        interpreterLabel: 'Python interpreter',
        defaultInterpreter: (isWindows) => isWindows ? 'python' : 'python3',
        defaultInterpreterArgs: () => ['-u'],
        description: 'Run a .py script (supports virtual environments)'
    },
    node: {
        id: 'node',
        label: 'Node.js script',
        shortLabel: 'Node.js',
        icon: 'file-code',
        extensions: ['js', 'mjs', 'cjs'],
        interpreterLabel: 'Node executable',
        defaultInterpreter: () => 'node',
        defaultInterpreterArgs: () => [],
        description: 'Run a .js / .mjs script with Node.js'
    },
    custom: {
        id: 'custom',
        label: 'Custom command',
        shortLabel: 'Command',
        icon: 'terminal',
        extensions: [],
        interpreterLabel: 'Command',
        defaultInterpreter: () => '',
        defaultInterpreterArgs: () => [],
        description: 'Any program or command line (make, gradle, docker, …)'
    }
};

export const SCRIPT_KIND_ORDER: ScriptKind[] = ['bash', 'batch', 'powershell', 'python', 'node', 'custom'];

/** Infer the script kind from a file name, or undefined if unknown. */
export function scriptKindForFile(fileName: string): ScriptKind | undefined {
    const ext = fileName.toLowerCase().split('.').pop() ?? '';
    return SCRIPT_KIND_ORDER.find(k => SCRIPT_KINDS[k].extensions.includes(ext));
}

/**
 * Metadata stored on managed script tasks in tasks.json under `taskManager`,
 * so the editor can reopen a task with the exact same form values.
 */
export interface TaskManagerMeta {
    kind: ScriptKind;
    /** Interpreter options before the script (e.g. -u, -NoProfile). */
    interpreterArgs: string[];
    /** Script path, workspace-relative using ${workspaceFolder…} when possible. Empty for custom commands. */
    script: string;
    /** Arguments passed to the script / command. */
    scriptArgs: string[];
    /** Custom commands only: run through the shell (pipes, &&, globbing). */
    useShell?: boolean;
}

/** Everything the script task editor edits. */
export interface ScriptTaskSpec {
    kind: ScriptKind;
    label: string;
    interpreter: string;
    interpreterArgs: string[];
    script: string;
    scriptArgs: string[];
    useShell: boolean;
    cwd: string;
    env: { [key: string]: string };
    group: 'build' | 'test' | 'none';
    reveal: 'always' | 'silent' | 'never';
    panel: 'shared' | 'dedicated' | 'new';
    clear: boolean;
}
