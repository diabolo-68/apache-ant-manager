/**
 * Minimal in-memory stand-in for the `vscode` module, so services can be unit-tested
 * in plain Node (fast, no VS Code download, identical on Linux and Windows).
 * Only the API surface used by the extension's services and tree view is implemented.
 */
import * as path from 'path';

export class Uri {
    private constructor(public readonly scheme: string, public readonly fsPath: string) {}
    static file(p: string): Uri { return new Uri('file', path.resolve(p)); }
    static joinPath(base: Uri, ...segments: string[]): Uri { return Uri.file(path.join(base.fsPath, ...segments)); }
    get path(): string { return this.fsPath.replace(/\\/g, '/'); }
    toString(): string { return `${this.scheme}://${this.path}`; }
}

export interface WorkspaceFolder { uri: Uri; name: string; index: number }

export class EventEmitter<T> {
    private _listeners: ((e: T) => void)[] = [];
    event = (listener: (e: T) => void) => {
        this._listeners.push(listener);
        return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
    };
    fire(e: T): void { this._listeners.forEach(l => l(e)); }
    dispose(): void { this._listeners = []; }
}

export enum TaskScope { Global = 1, Workspace = 2 }
export enum TaskRevealKind { Always = 1, Silent = 2, Never = 3 }
export enum TaskPanelKind { Shared = 1, Dedicated = 2, New = 3 }
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }

export class ShellExecution {
    constructor(public commandLine: string, public args: string[], public options?: any) {}
}
export class ProcessExecution {
    constructor(public process: string, public args: string[], public options?: any) {}
}
export class Task {
    presentationOptions: any;
    constructor(public definition: any, public scope: any, public name: string, public source: string,
        public execution: ShellExecution | ProcessExecution, public problemMatchers: string[]) {}
}

export class ThemeIcon {
    static readonly File = new ThemeIcon('file');
    static readonly Folder = new ThemeIcon('folder');
    constructor(public readonly id: string) {}
}

export class MarkdownString {
    value = '';
    appendMarkdown(s: string): this { this.value += s; return this; }
    appendCodeblock(code: string, lang = ''): this { this.value += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`; return this; }
}

export class TreeItem {
    id?: string;
    description?: string;
    tooltip?: string | MarkdownString;
    iconPath?: ThemeIcon | Uri;
    contextValue?: string;
    resourceUri?: Uri;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(public label: string, public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None) {}
}

/** Mutable state the tests control. */
export const state = {
    folders: [] as WorkspaceFolder[],
    workspaceFile: undefined as Uri | undefined,
    config: {} as Record<string, unknown>,
    messages: [] as { level: string; text: string }[],
    executed: [] as Task[],
    fetched: [] as Task[]
};

/** Reset the stub between tests; `folders` are absolute paths (the folder name is the basename). */
export function reset(folders: string[] = [], workspaceFile?: string): void {
    state.folders = folders.map((p, index) => ({ uri: Uri.file(p), name: path.basename(p), index }));
    state.workspaceFile = workspaceFile ? Uri.file(workspaceFile) : undefined;
    state.config = {};
    state.messages = [];
    state.executed = [];
    state.fetched = [];
}

export const workspace = {
    get workspaceFolders() { return state.folders.length ? state.folders : undefined; },
    get workspaceFile() { return state.workspaceFile; },
    getConfiguration(section?: string) {
        return {
            get<T>(key: string, defaultValue?: T): T | undefined {
                const full = section ? `${section}.${key}` : key;
                return (full in state.config ? state.config[full] : defaultValue) as T | undefined;
            }
        };
    },
    getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
        const isWin = process.platform === 'win32';
        const norm = (p: string) => isWin ? p.toLowerCase() : p;
        return state.folders.find(f => {
            const root = norm(f.uri.fsPath);
            const target = norm(uri.fsPath);
            return target === root || target.startsWith(root + path.sep);
        });
    },
    async findFiles(): Promise<Uri[]> { return []; }
};

const record = (level: string) => async (text: string) => { state.messages.push({ level, text }); return undefined; };

export const window = {
    showInformationMessage: record('info'),
    showWarningMessage: record('warning'),
    showErrorMessage: record('error')
};

export const tasks = {
    async executeTask(task: Task) { state.executed.push(task); return {}; },
    async fetchTasks() { return state.fetched; }
};

export const commands = {
    async executeCommand() { return undefined; }
};
