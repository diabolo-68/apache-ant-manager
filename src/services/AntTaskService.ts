import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as jsonc from 'jsonc-parser';
import { TaskKind, TaskManagerMeta } from '../types/taskKinds';

/**
 * Represents an Ant task configuration stored in tasks.json
 */
export interface AntTaskConfig {
    label: string;
    type: string;
    command: string;
    args: string[];
    options?: {
        cwd?: string;
        env?: { [key: string]: string };
        shell?: {
            executable?: string;
            args?: string[];
        };
    };
    group?: { kind: string; isDefault: boolean } | string;
    problemMatcher?: string | string[];
    presentation?: { reveal?: string; panel?: string; clear?: boolean };
    /** Platform-specific overrides (tasks.json `windows` / `linux` / `osx` blocks). */
    windows?: { command?: string; args?: string[] };
    linux?: { command?: string; args?: string[] };
    osx?: { command?: string; args?: string[] };
    /** Present on script / command tasks created by this extension. */
    taskManager?: TaskManagerMeta;
    // Parsed fields for UI
    buildFile?: string;
    rawBuildFile?: string;
    targets?: string[];
    additionalArgs?: string;
    workingDirectory?: string;
    antHome?: string;
    javaHome?: string;
    shell?: string;
}

/**
 * Service for managing Ant tasks in VS Code.
 */
export class AntTaskService {
    
    /**
     * Convert an absolute path to a workspace-relative path using ${workspaceFolder:NAME}.
     * Checks all workspace folders and returns the relative path for the matching one.
     * Returns the original path if it's not within any workspace folder.
     */
    toWorkspaceRelativePath(absolutePath: string): string {
        if (!absolutePath) {return absolutePath;}
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return absolutePath;
        }

        const normalizedPath = path.normalize(absolutePath);
        const isWindows = process.platform === 'win32';
        const pathLower = isWindows ? normalizedPath.toLowerCase() : normalizedPath;

        // Check each workspace folder to find which one contains this path
        for (const folder of workspaceFolders) {
            const folderPath = path.normalize(folder.uri.fsPath);
            const folderLower = isWindows ? folderPath.toLowerCase() : folderPath;
            
            if (isInside(pathLower, folderLower)) {
                const relativePath = normalizedPath.substring(folderPath.length);
                // Remove leading separator if present
                const cleanRelative = relativePath.startsWith(path.sep) ? relativePath.substring(1) : relativePath;
                // Use forward slashes for consistency in tasks.json
                const relativeWithSlashes = cleanRelative.replace(/\\/g, '/');
                
                // Use ${workspaceFolder:NAME} syntax for multi-root workspace support
                // If only one workspace folder, use simple ${workspaceFolder}
                if (workspaceFolders.length === 1) {
                    return relativeWithSlashes ? `\${workspaceFolder}/${relativeWithSlashes}` : '${workspaceFolder}';
                } else {
                    return relativeWithSlashes 
                        ? `\${workspaceFolder:${folder.name}}/${relativeWithSlashes}` 
                        : `\${workspaceFolder:${folder.name}}`;
                }
            }
        }
        
        return absolutePath;
    }

    /**
     * Resolve a workspace-relative path (containing ${workspaceFolder} or ${workspaceFolder:NAME}) to an absolute path.
     */
    resolveWorkspacePath(relativePath: string): string {
        if (!relativePath) {return relativePath;}
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return relativePath;
        }

        // Handle ${workspaceFolder:NAME} syntax
        const namedMatch = relativePath.match(/\$\{workspaceFolder:([^}]+)\}/);
        if (namedMatch) {
            const folderName = namedMatch[1];
            const folder = workspaceFolders.find(f => f.name === folderName);
            if (folder) {
                return relativePath
                    .replace(/\$\{workspaceFolder:[^}]+\}/g, folder.uri.fsPath)
                    .replace(/\//g, path.sep);
            }
        }
        
        // Handle simple ${workspaceFolder} syntax (uses first workspace folder)
        if (relativePath.includes('${workspaceFolder}')) {
            return relativePath
                .replace(/\$\{workspaceFolder\}/g, workspaceFolders[0].uri.fsPath)
                .replace(/\//g, path.sep);
        }
        
        return relativePath;
    }

    /**
     * Get the shell executable path for a given shell type.
     */
    private getShellExecutable(shell: string): string {
        const isWindows = process.platform === 'win32';
        switch (shell) {
            case 'powershell':
                return isWindows ? 'powershell.exe' : 'pwsh';
            case 'cmd':
                return 'cmd.exe';
            case 'bash':
                return isWindows ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/bash';
            case 'sh':
                return '/bin/sh';
            case 'zsh':
                return '/bin/zsh';
            case 'wsl':
                return 'wsl.exe';
            default:
                return isWindows ? 'cmd.exe' : '/bin/bash';
        }
    }

    /**
     * Get the shell arguments for a given shell type.
     */
    private getShellArgs(shell: string): string[] {
        switch (shell) {
            case 'powershell':
                return ['-NoProfile', '-Command'];
            case 'cmd':
                return ['/d', '/c'];
            case 'bash':
            case 'sh':
            case 'zsh':
                return ['-c'];
            case 'wsl':
                return ['-e', 'bash', '-c'];
            default:
                return [];
        }
    }

    /**
     * Detect the shell type from a task configuration.
     */
    private detectShellFromConfig(task: AntTaskConfig): string {
        const shellExec = task.options?.shell?.executable?.toLowerCase() || '';
        
        if (!shellExec) {
            return 'default';
        }
        
        if (shellExec.includes('powershell') || shellExec.includes('pwsh')) {
            return 'powershell';
        } else if (shellExec.includes('cmd')) {
            return 'cmd';
        } else if (shellExec.includes('wsl')) {
            return 'wsl';
        } else if (shellExec.includes('zsh')) {
            return 'zsh';
        } else if (shellExec.includes('bash')) {
            return 'bash';
        } else if (shellExec.endsWith('/sh') || shellExec === 'sh') {
            return 'sh';
        }
        
        return 'default';
    }
    /**
     * Get the path to the workspace tasks.json file for a specific workspace folder.
     * If no folder is specified, returns the first workspace folder's tasks.json.
     */
    private getTasksJsonPath(workspaceFolder?: vscode.WorkspaceFolder): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        const folder = workspaceFolder || workspaceFolders[0];
        return path.join(folder.uri.fsPath, '.vscode', 'tasks.json');
    }

    /**
     * Find the workspace folder that contains the given file path.
     */
    getWorkspaceFolderForFile(filePath: string): vscode.WorkspaceFolder | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }

        const normalizedPath = path.normalize(filePath);
        const isWindows = process.platform === 'win32';
        const pathLower = isWindows ? normalizedPath.toLowerCase() : normalizedPath;

        for (const folder of workspaceFolders) {
            const folderPath = path.normalize(folder.uri.fsPath);
            const folderLower = isWindows ? folderPath.toLowerCase() : folderPath;
            
            if (isInside(pathLower, folderLower)) {
                return folder;
            }
        }

        // If file is not in any workspace folder, return first folder as fallback
        return workspaceFolders[0];
    }

    /**
     * Read all tasks from tasks.json for a specific workspace folder.
     */
    readTasksJson(workspaceFolder?: vscode.WorkspaceFolder): { version: string; tasks: AntTaskConfig[] } {
        const tasksPath = this.getTasksJsonPath(workspaceFolder);
        if (!tasksPath || !fs.existsSync(tasksPath)) {
            return { version: '2.0.0', tasks: [] };
        }
        const parsed = parseJsonc(fs.readFileSync(tasksPath, 'utf8'), tasksPath);
        return { ...parsed, version: parsed.version ?? '2.0.0', tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
    }

    /**
     * Read tasks.json without throwing (used for listing: a broken file shows no tasks
     * instead of breaking the whole view). Writes always go through readTasksJson, which throws.
     */
    private tryReadTasksJson(workspaceFolder?: vscode.WorkspaceFolder): { tasks: AntTaskConfig[] } {
        try {
            return this.readTasksJson(workspaceFolder);
        } catch (e) {
            console.warn(String(e));
            return { tasks: [] };
        }
    }

    /** Write the tasks array of a folder's tasks.json, preserving comments and other properties. */
    private writeTasksJson(folder: vscode.WorkspaceFolder, tasks: AntTaskConfig[]): void {
        const vscodeDir = path.join(folder.uri.fsPath, '.vscode');
        const tasksPath = path.join(vscodeDir, 'tasks.json');
        fs.mkdirSync(vscodeDir, { recursive: true });
        const existing = fs.existsSync(tasksPath) ? fs.readFileSync(tasksPath, 'utf8') : '';
        let content = existing.trim() ? existing : '{\n    "version": "2.0.0",\n    "tasks": []\n}\n';
        const current = parseJsonc(content, tasksPath); // refuse to rewrite a file we cannot parse
        if (current.version === undefined) {
            content = applyJsoncEdit(content, ['version'], '2.0.0');
        }
        content = applyJsoncEdit(content, ['tasks'], tasks.map(cleanTask));
        fs.writeFileSync(tasksPath, content, 'utf8');
    }

    /**
     * Get the path to the workspace file (.code-workspace) if this is a multi-root workspace.
     */
    getWorkspaceFilePath(): string | undefined {
        const workspaceFile = vscode.workspace.workspaceFile;
        if (workspaceFile && workspaceFile.scheme === 'file') {
            return workspaceFile.fsPath;
        }
        return undefined;
    }

    /**
     * Read tasks from the workspace file (.code-workspace).
     */
    readWorkspaceTasks(): { tasks: AntTaskConfig[] } {
        const workspaceFilePath = this.getWorkspaceFilePath();
        if (!workspaceFilePath || !fs.existsSync(workspaceFilePath)) {
            return { tasks: [] };
        }
        const config = parseJsonc(fs.readFileSync(workspaceFilePath, 'utf8'), workspaceFilePath);
        const tasks = config.tasks?.tasks;
        return { tasks: Array.isArray(tasks) ? tasks : [] };
    }

    private tryReadWorkspaceTasks(): { tasks: AntTaskConfig[] } {
        try {
            return this.readWorkspaceTasks();
        } catch (e) {
            console.warn(String(e));
            return { tasks: [] };
        }
    }

    /**
     * Save tasks to the workspace file (.code-workspace), preserving comments and other settings.
     */
    private saveWorkspaceTasks(tasks: AntTaskConfig[]): void {
        const workspaceFilePath = this.getWorkspaceFilePath();
        if (!workspaceFilePath) {
            throw new Error('No workspace file found');
        }
        let content = fs.existsSync(workspaceFilePath) ? fs.readFileSync(workspaceFilePath, 'utf8') : '{}';
        const config = parseJsonc(content, workspaceFilePath);
        if (!config.tasks || typeof config.tasks !== 'object') {
            content = applyJsoncEdit(content, ['tasks'], { version: '2.0.0', tasks: [] });
        } else if (config.tasks.version === undefined) {
            content = applyJsoncEdit(content, ['tasks', 'version'], '2.0.0');
        }
        content = applyJsoncEdit(content, ['tasks', 'tasks'], tasks.map(cleanTask));
        fs.writeFileSync(workspaceFilePath, content, 'utf8');
    }

    /**
     * Check if this is a multi-root workspace (has a .code-workspace file).
     */
    isMultiRootWorkspace(): boolean {
        return !!this.getWorkspaceFilePath();
    }

    /**
     * Get all Ant-related tasks from all workspace folders and the workspace file.
     * Each task includes a _workspaceFolder property indicating which folder it belongs to.
     * Workspace-level tasks have _workspaceFolderName set to '__workspace__'.
     */
    getAntTasks(): AntTaskConfig[] {
        return this.collectTasks(task => this.isAntTask(task));
    }

    /**
     * Get every task this extension manages: Ant tasks plus script / command tasks.
     */
    getManagedTasks(): AntTaskConfig[] {
        return this.collectTasks(task => this.isAntTask(task) || this.isScriptTask(task));
    }

    /** Kind of a managed task. */
    kindOf(task: AntTaskConfig): TaskKind {
        return task.taskManager?.kind ?? 'ant';
    }

    /** The command VS Code will run on this OS (honours the tasks.json `windows` override). */
    effectiveCommand(task: AntTaskConfig, platform: NodeJS.Platform = process.platform): string {
        const override = platform === 'win32' ? task.windows : platform === 'darwin' ? task.osx : task.linux;
        return override?.command || task.command || '';
    }

    /** True for script / command tasks created by this extension. */
    isScriptTask(task: AntTaskConfig): boolean {
        return !!task.taskManager && typeof task.taskManager.kind === 'string';
    }

    private collectTasks(filter: (task: AntTaskConfig) => boolean): AntTaskConfig[] {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        const allTasks: AntTaskConfig[] = [];

        // Get tasks from each workspace folder
        for (const folder of workspaceFolders) {
            const tasksJson = this.tryReadTasksJson(folder);
            const matching = tasksJson.tasks.filter(filter);
            // Tag each task with its workspace folder for later reference
            matching.forEach(task => {
                (task as any)._workspaceFolder = folder;
                (task as any)._workspaceFolderName = folder.name;
                (task as any)._isWorkspaceLevel = false;
            });
            allTasks.push(...matching);
        }

        // Get tasks from workspace file (if multi-root)
        if (this.isMultiRootWorkspace()) {
            const workspaceTasks = this.tryReadWorkspaceTasks();
            const matching = workspaceTasks.tasks.filter(filter);
            matching.forEach(task => {
                (task as any)._workspaceFolder = undefined;
                (task as any)._workspaceFolderName = '__workspace__';
                (task as any)._isWorkspaceLevel = true;
            });
            allTasks.push(...matching);
        }

        return allTasks;
    }

    /**
     * Check if a task is an Ant task (by looking at command or args).
     */
    private isAntTask(task: AntTaskConfig): boolean {
        if (task.taskManager) {return false;}
        if (!task.command) {return false;}
        const cmd = task.command.toLowerCase();
        if (cmd.includes('ant')) {return true;}
        if (task.args && task.args.some(arg => arg.includes('-f') || arg.endsWith('.xml'))) {
            return true;
        }
        return false;
    }

    /**
     * Parse an Ant task to extract build file, targets, and additional arguments.
     */
    parseAntTask(task: AntTaskConfig): AntTaskConfig {
        const parsed: AntTaskConfig = { ...task };
        parsed.targets = [];
        // Preserve the raw workspace-relative working directory (may contain ${workspaceFolder})
        parsed.workingDirectory = task.options?.cwd || '';
        parsed.antHome = task.options?.env?.ANT_HOME || '';
        parsed.javaHome = task.options?.env?.JAVA_HOME || '';
        parsed.shell = this.detectShellFromConfig(task);

        if (!task.args) {return parsed;}

        const additionalArgsList: string[] = [];
        let i = 0;
        while (i < task.args.length) {
            const arg = task.args[i];
            if (arg === '-f' && i + 1 < task.args.length) {
                // Preserve the raw build file path (may contain ${workspaceFolder})
                parsed.rawBuildFile = task.args[i + 1];
                // Resolve workspace-relative build file path for display/parsing
                parsed.buildFile = this.resolveWorkspacePath(task.args[i + 1]);
                i += 2;
            } else if (arg.startsWith('-')) {
                // All arguments starting with - are additional args
                additionalArgsList.push(quoteArg(arg));
                i++;
            } else {
                // Arguments not starting with - are targets
                parsed.targets!.push(arg);
                i++;
            }
        }
        
        // Join additional arguments with newlines for display in textarea
        parsed.additionalArgs = additionalArgsList.join('\n');

        return parsed;
    }

    /**
     * Run a saved task from tasks.json by its label.
     * This is equivalent to running "Run Task" from the command palette.
     */
    async runSavedTask(taskLabel: string, folderName?: string): Promise<boolean> {
        // Fetch all tasks defined in the workspace (including tasks.json)
        const allTasks = await vscode.tasks.fetchTasks();

        // Find the task by label, preferring the one in the requested scope
        // ('__workspace__' = .code-workspace file, otherwise a workspace folder name)
        const inScope = (task: vscode.Task) => {
            if (!folderName) { return true; }
            if (folderName === '__workspace__') {
                return task.scope === vscode.TaskScope.Workspace;
            }
            return typeof task.scope === 'object' && task.scope.name === folderName;
        };
        const byName = allTasks.filter(task => task.name === taskLabel);
        const taskToRun = byName.find(inScope) ?? byName[0];
        
        if (taskToRun) {
            await vscode.tasks.executeTask(taskToRun);
            return true;
        }
        
        // Task not found - show error
        vscode.window.showErrorMessage(`Task "${taskLabel}" not found. Please save the task first.`);
        return false;
    }

    /**
     * Run Ant targets by creating a temporary task and executing it via VS Code's task system.
     */
    async runAntTargets(
        buildFilePath: string, 
        targets: string[],
        additionalArgs?: string,
        workingDirectory?: string,
        antHome?: string,
        javaHome?: string,
        shell?: string
    ): Promise<void> {
        // Generate a task configuration
        const taskConfig = this.generateTaskConfig(
            buildFilePath,
            targets,
            `Ant: ${targets.join(', ')}`,
            additionalArgs || '',
            workingDirectory,
            antHome,
            javaHome,
            shell
        );

        // Create a proper VS Code Task from the configuration
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceFolder = workspaceFolders && workspaceFolders.length > 0 
            ? workspaceFolders[0] 
            : undefined;

        const taskDefinition: vscode.TaskDefinition = {
            type: 'shell'
        };

        // Build shell execution options
        const shellOptions: vscode.ShellExecutionOptions = {};
        
        if (taskConfig.options?.cwd) {
            shellOptions.cwd = this.resolveWorkspacePath(taskConfig.options.cwd);
        }
        
        if (taskConfig.options?.env) {
            shellOptions.env = taskConfig.options.env;
        }

        // Set shell executable if specified in the task config
        if (taskConfig.options?.shell?.executable) {
            shellOptions.executable = taskConfig.options.shell.executable;
            shellOptions.shellArgs = taskConfig.options.shell.args;
        }

        // Create ShellExecution with command and args
        const shellExecution = new vscode.ShellExecution(
            taskConfig.command,
            taskConfig.args.map(arg => this.resolveWorkspacePath(arg)),
            shellOptions
        );

        const task = new vscode.Task(
            taskDefinition,
            workspaceFolder || vscode.TaskScope.Workspace,
            taskConfig.label,
            'ant',
            shellExecution,
            []
        );

        // Execute the task
        await vscode.tasks.executeTask(task);
    }

    /**
     * Generate a tasks.json entry for Ant targets.
     */
    generateTaskConfig(
        buildFilePath: string, 
        targets: string[], 
        taskName: string,
        additionalArgs: string = '',
        workingDirectory?: string,
        antHome?: string,
        javaHome?: string,
        shell?: string
    ): AntTaskConfig {
        const cwd = workingDirectory || path.dirname(buildFilePath);
        
        // Convert paths to workspace-relative where possible
        // If the path already contains ${workspaceFolder}, use it as-is
        const relativeBuildFilePath = buildFilePath.includes('${workspaceFolder')
            ? buildFilePath
            : this.toWorkspaceRelativePath(buildFilePath);
        const relativeCwd = cwd.includes('${workspaceFolder')
            ? cwd
            : this.toWorkspaceRelativePath(cwd);
        
        let antCommand = 'ant';
        if (antHome) {
            antCommand = path.join(antHome, 'bin', 'ant');
        }

        const args: string[] = ['-f', relativeBuildFilePath];

        // Add additional arguments
        const parsedAdditionalArgs = this.parseAdditionalArgs(additionalArgs);
        args.push(...parsedAdditionalArgs);

        // Add targets
        args.push(...targets);

        const taskConfig: AntTaskConfig = {
            label: taskName,
            type: 'shell',
            command: antCommand,
            args: args,
            options: {
                cwd: relativeCwd
            },
            group: {
                kind: 'build',
                isDefault: false
            },
            problemMatcher: [],
            presentation: {
                reveal: 'always',
                panel: 'new'
            }
        };

        // Add environment variables if specified
        if (antHome || javaHome) {
            taskConfig.options!.env = {};
            if (antHome) {
                taskConfig.options!.env['ANT_HOME'] = antHome;
            }
            if (javaHome) {
                taskConfig.options!.env['JAVA_HOME'] = javaHome;
            }
            
            // Extend PATH with JAVA_HOME/bin and ANT_HOME/bin
            const pathSeparator = process.platform === 'win32' ? ';' : ':';
            const pathAdditions: string[] = [];
            if (javaHome) {
                pathAdditions.push(path.join(javaHome, 'bin'));
            }
            if (antHome) {
                pathAdditions.push(path.join(antHome, 'bin'));
            }
            if (pathAdditions.length > 0) {
                // Use ${env:PATH} syntax for tasks.json to reference existing PATH at runtime
                taskConfig.options!.env['PATH'] = pathAdditions.join(pathSeparator) + pathSeparator + '${env:PATH}';
            }
        }

        // Store additional fields for UI
        taskConfig.workingDirectory = cwd;
        taskConfig.antHome = antHome;
        taskConfig.javaHome = javaHome;
        taskConfig.shell = shell;
        taskConfig.additionalArgs = additionalArgs;

        // Add shell configuration if specified
        if (shell && shell !== 'default') {
            taskConfig.options!.shell = {
                executable: this.getShellExecutable(shell),
                args: this.getShellArgs(shell)
            };
        }

        return taskConfig;
    }

    /**
     * Parse additional arguments from a string (newline or space separated).
     */
    private parseAdditionalArgs(argsString: string): string[] {
        if (!argsString || argsString.trim() === '') {
            return [];
        }
        
        // Split by newlines first, then handle each line
        const lines = argsString.split(/[\r\n]+/).filter(line => line.trim() !== '');
        const args: string[] = [];
        
        for (const line of lines) {
            args.push(...splitArgs(line));
        }
        
        return args;
    }

    /**
     * Save a new task to tasks.json in the specified workspace folder or workspace file.
     * @param taskConfig The task configuration to save
     * @param workspaceFolder The workspace folder to save to (uses first folder if not specified)
     * @param saveToWorkspaceFile If true, saves to the workspace file instead of a folder
     */
    async saveTaskToWorkspace(
        taskConfig: AntTaskConfig, 
        workspaceFolder?: vscode.WorkspaceFolder,
        saveToWorkspaceFile?: boolean
    ): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder open');
        }

        if (saveToWorkspaceFile) {
            // Save to workspace file (.code-workspace)
            if (!this.isMultiRootWorkspace()) {
                throw new Error('No workspace file available. This is only supported in multi-root workspaces.');
            }
            const workspaceTasks = this.readWorkspaceTasks();
            workspaceTasks.tasks.push(toStoredTask(taskConfig));
            this.saveWorkspaceTasks(workspaceTasks.tasks);
            vscode.window.showInformationMessage(`Task "${taskConfig.label}" saved to the workspace file`);
        } else {
            // Save to folder's tasks.json
            const targetFolder = workspaceFolder || workspaceFolders[0];
            const tasksJson = this.readTasksJson(targetFolder);
            this.writeTasksJson(targetFolder, [...tasksJson.tasks, toStoredTask(taskConfig)]);

            const folderInfo = workspaceFolders.length > 1 ? ` (${targetFolder.name})` : '';
            vscode.window.showInformationMessage(`Task "${taskConfig.label}" saved to tasks.json${folderInfo}`);
        }
    }

    /**
     * Update an existing task in tasks.json by label.
     * Supports moving tasks between folders or to/from the workspace file.
     * @param originalLabel Original task label to find
     * @param taskConfig New task configuration
     * @param targetWorkspaceFolder Target folder (undefined = search all, null = workspace file)
     * @param sourceWorkspaceFolder Source folder where the task currently exists (undefined = search all, '__workspace__' = workspace file)
     */
    async updateTask(
        originalLabel: string, 
        taskConfig: AntTaskConfig, 
        targetWorkspaceFolder?: vscode.WorkspaceFolder | null,
        sourceWorkspaceFolder?: vscode.WorkspaceFolder | string
    ): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder open');
        }

        // Determine if source is workspace file
        const sourceIsWorkspaceFile = sourceWorkspaceFolder === '__workspace__';
        // Determine if target is workspace file (null means workspace file)
        const targetIsWorkspaceFile = targetWorkspaceFolder === null;
        
        const stored = toStoredTask(taskConfig);

        // Same location: replace the task where it is, so its position in tasks.json is kept.
        if (sourceIsWorkspaceFile && targetIsWorkspaceFile) {
            const workspaceTasks = this.readWorkspaceTasks();
            const index = workspaceTasks.tasks.findIndex(t => t.label === originalLabel);
            if (index === -1) {
                throw new Error(`Task "${originalLabel}" not found in workspace file`);
            }
            workspaceTasks.tasks[index] = stored;
            this.saveWorkspaceTasks(workspaceTasks.tasks);
            vscode.window.showInformationMessage(`Task "${taskConfig.label}" updated`);
            return;
        }

        // First, delete from source location
        if (sourceIsWorkspaceFile) {
            const workspaceTasks = this.readWorkspaceTasks();
            const index = workspaceTasks.tasks.findIndex(t => t.label === originalLabel);
            if (index === -1) {
                throw new Error(`Task "${originalLabel}" not found in workspace file`);
            }
            workspaceTasks.tasks.splice(index, 1);
            this.saveWorkspaceTasks(workspaceTasks.tasks);
        } else {
            const foldersToSearch = sourceWorkspaceFolder && typeof sourceWorkspaceFolder !== 'string'
                ? [sourceWorkspaceFolder]
                : workspaceFolders;
            const targetFolder = targetIsWorkspaceFile ? undefined : (targetWorkspaceFolder || workspaceFolders[0]);
            let found = false;

            for (const folder of foldersToSearch) {
                const tasksJson = this.readTasksJson(folder);
                const index = tasksJson.tasks.findIndex(t => t.label === originalLabel);
                if (index === -1) { continue; }

                if (targetFolder && folder.uri.fsPath === targetFolder.uri.fsPath) {
                    tasksJson.tasks[index] = stored;
                    this.writeTasksJson(folder, tasksJson.tasks);
                    vscode.window.showInformationMessage(`Task "${taskConfig.label}" updated`);
                    return;
                }
                tasksJson.tasks.splice(index, 1);
                this.writeTasksJson(folder, tasksJson.tasks);
                found = true;
                break;
            }

            if (!found && sourceWorkspaceFolder) {
                throw new Error(`Task "${originalLabel}" not found`);
            }
        }

        // Then, add to the target location
        if (targetIsWorkspaceFile) {
            const workspaceTasks = this.readWorkspaceTasks();
            workspaceTasks.tasks.push(stored);
            this.saveWorkspaceTasks(workspaceTasks.tasks);
        } else {
            const targetFolder = targetWorkspaceFolder || workspaceFolders[0];
            const tasksJson = this.readTasksJson(targetFolder);
            this.writeTasksJson(targetFolder, [...tasksJson.tasks, stored]);
        }

        vscode.window.showInformationMessage(`Task "${taskConfig.label}" updated`);
    }

    /**
     * Delete a task from tasks.json by label.
     * Searches all workspace folders and the workspace file to find and delete the task.
     */
    async deleteTask(label: string, workspaceFolder?: vscode.WorkspaceFolder | string): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder open');
        }

        // Check if looking in workspace file
        if (workspaceFolder === '__workspace__') {
            const workspaceTasks = this.readWorkspaceTasks();
            const index = workspaceTasks.tasks.findIndex(t => t.label === label);
            if (index !== -1) {
                workspaceTasks.tasks.splice(index, 1);
                this.saveWorkspaceTasks(workspaceTasks.tasks);
                vscode.window.showInformationMessage(`Task "${label}" deleted from workspace file`);
                return;
            }
            throw new Error(`Task "${label}" not found in workspace file`);
        }

        // If workspace folder is specified, only look there
        const foldersToSearch = workspaceFolder && typeof workspaceFolder !== 'string' 
            ? [workspaceFolder] 
            : workspaceFolders;

        for (const folder of foldersToSearch) {
            const tasksPath = this.getTasksJsonPath(folder);
            if (!tasksPath) {continue;}

            const tasksJson = this.readTasksJson(folder);
            const index = tasksJson.tasks.findIndex(t => t.label === label);
            
            if (index !== -1) {
                tasksJson.tasks.splice(index, 1);
                this.writeTasksJson(folder, tasksJson.tasks);
                vscode.window.showInformationMessage(`Task "${label}" deleted`);
                return;
            }
        }

        // Also check workspace file if not already deleted
        if (this.isMultiRootWorkspace()) {
            const workspaceTasks = this.readWorkspaceTasks();
            const index = workspaceTasks.tasks.findIndex(t => t.label === label);
            if (index !== -1) {
                workspaceTasks.tasks.splice(index, 1);
                this.saveWorkspaceTasks(workspaceTasks.tasks);
                vscode.window.showInformationMessage(`Task "${label}" deleted from workspace file`);
                return;
            }
        }

        throw new Error(`Task "${label}" not found`);
    }
}

/** True if `child` is `parent` itself or lies inside it (compares whole path segments). */
function isInside(child: string, parent: string): boolean {
    const p = parent.endsWith(path.sep) ? parent.slice(0, -1) : parent;
    return child === p || child.startsWith(p + path.sep);
}

/**
 * Split one line of arguments like a shell does: whitespace separates arguments, and single or
 * double quotes group text (the quotes themselves are removed). VS Code re-quotes each argument
 * correctly for the shell that runs the task, so stored args must not contain literal quotes.
 */
export function splitArgs(line: string): string[] {
    const out: string[] = [];
    const re = /(?:[^\s"']+|"([^"]*)"|'([^']*)')+/g;
    for (const m of line.matchAll(re)) {
        out.push(m[0].replace(/"([^"]*)"|'([^']*)'/g, (_q, d, s) => d ?? s));
    }
    return out;
}

/** Inverse of splitArgs for display: quote an argument (or a -D property value) containing whitespace. */
export function quoteArg(arg: string): string {
    if (!/\s/.test(arg)) { return arg; }
    const prop = arg.match(/^(-D[^=]+=)(.*)$/s);
    return prop ? `${prop[1]}"${prop[2]}"` : `"${arg}"`;
}

/** Parse a JSON-with-comments file (tasks.json, .code-workspace). Throws on syntax errors. */
export function parseJsonc(content: string, fileName: string): any {
    const errors: jsonc.ParseError[] = [];
    const value = jsonc.parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || value === null || typeof value !== 'object' || Array.isArray(value)) {
        const first = errors[0];
        const where = first ? ` (${jsonc.printParseErrorCode(first.error)} at offset ${first.offset})` : '';
        throw new Error(`Cannot parse ${fileName}${where}. Fix the file before saving tasks so it is not overwritten.`);
    }
    return value;
}

/** Replace the value at `jsonPath`, keeping the rest of the document (comments included) untouched. */
function applyJsoncEdit(content: string, jsonPath: jsonc.JSONPath, value: unknown): string {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const edits = jsonc.modify(content, jsonPath, value, {
        formattingOptions: { insertSpaces: true, tabSize: 4, eol }
    });
    return jsonc.applyEdits(content, edits);
}

/** Fields the editors attach to a task config for their own use; never written to tasks.json. */
const UI_ONLY_FIELDS = ['buildFile', 'rawBuildFile', 'targets', 'additionalArgs', 'workingDirectory', 'antHome', 'javaHome', 'shell'];

/** Strip the in-memory bookkeeping fields (`_workspaceFolder`, …) added by collectTasks before persisting. */
function cleanTask(task: AntTaskConfig): AntTaskConfig {
    return Object.fromEntries(Object.entries(task).filter(([k]) => !k.startsWith('_'))) as AntTaskConfig;
}

/** A task config as it should be stored: bookkeeping and editor-only fields removed. */
export function toStoredTask(task: AntTaskConfig): AntTaskConfig {
    const out: any = cleanTask(task);
    for (const key of UI_ONLY_FIELDS) { delete out[key]; }
    return out;
}
