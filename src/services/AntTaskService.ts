import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
    group?: { kind: string; isDefault: boolean };
    problemMatcher?: string | string[];
    presentation?: { reveal: string; panel: string };
    // Parsed fields for UI (extracted from standard task properties)
    buildFile?: string;
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
     * Get all workspace folders.
     */
    getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
        return vscode.workspace.workspaceFolders || [];
    }

    /**
     * Check if this is a multi-root workspace.
     */
    isMultiRootWorkspace(): boolean {
        const folders = vscode.workspace.workspaceFolders;
        return folders !== undefined && folders.length > 1;
    }

    /**
     * Convert an absolute path to a workspace-relative path using ${workspaceFolder}.
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
            
            if (pathLower.startsWith(folderLower)) {
                const relativePath = normalizedPath.substring(folderPath.length);
                // Remove leading separator if present
                const cleanRelative = relativePath.startsWith(path.sep) ? relativePath.substring(1) : relativePath;
                // Use forward slashes for consistency in tasks.json
                const relativeWithSlashes = cleanRelative.replace(/\\/g, '/');
                
                return relativeWithSlashes ? `\${workspaceFolder}/${relativeWithSlashes}` : '${workspaceFolder}';
            }
        }
        
        return absolutePath;
    }

    /**
     * Resolve a workspace-relative path (containing ${workspaceFolder}) to an absolute path.
     * @param relativePath The path to resolve
     * @param workspaceFolderName Optional specific workspace folder name to use for resolution
     */
    resolveWorkspacePath(relativePath: string, workspaceFolderName?: string): string {
        if (!relativePath) {return relativePath;}
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return relativePath;
        }
        
        // Handle ${workspaceFolder} syntax
        if (relativePath.includes('${workspaceFolder}')) {
            // Find the target workspace folder
            let targetFolder = workspaceFolders[0];
            if (workspaceFolderName) {
                const found = workspaceFolders.find(f => f.name === workspaceFolderName);
                if (found) {
                    targetFolder = found;
                }
            }
            
            return relativePath
                .replace(/\$\{workspaceFolder\}/g, targetFolder.uri.fsPath)
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
     * Get the path to the workspace tasks.json file.
     * @param workspaceFolderName Optional name of specific workspace folder (for multi-root)
     */
    private getTasksJsonPath(workspaceFolderName?: string): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        
        let targetFolder = workspaceFolders[0];
        if (workspaceFolderName) {
            const found = workspaceFolders.find(f => f.name === workspaceFolderName);
            if (found) {
                targetFolder = found;
            }
        }
        
        return path.join(targetFolder.uri.fsPath, '.vscode', 'tasks.json');
    }

    /**
     * Read all tasks from tasks.json.
     * @param workspaceFolderName Optional name of specific workspace folder (for multi-root)
     */
    readTasksJson(workspaceFolderName?: string): { version: string; tasks: AntTaskConfig[] } {
        const tasksPath = this.getTasksJsonPath(workspaceFolderName);
        if (!tasksPath || !fs.existsSync(tasksPath)) {
            return { version: '2.0.0', tasks: [] };
        }

        try {
            const content = fs.readFileSync(tasksPath, 'utf8');
            return JSON.parse(content);
        } catch {
            return { version: '2.0.0', tasks: [] };
        }
    }

    /**
     * Get all Ant tasks from all workspace folders' tasks.json files.
     * Extracts properties directly from standard VS Code task format.
     */
    getAntTasks(): AntTaskConfig[] {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        const allTasks: AntTaskConfig[] = [];
        
        for (const folder of workspaceFolders) {
            const tasksJson = this.readTasksJson(folder.name);
            const antTasks = tasksJson.tasks.filter(task => this.isAntTask(task));
            
            // Add workspace folder info and parse properties for each task
            for (const task of antTasks) {
                // Store which workspace this task belongs to (for UI display and editing)
                (task as any)._workspaceFolder = folder.name;
                
                // Parse properties from standard task format
                const parsed = this.parseAntTask(task);
                allTasks.push(parsed);
            }
        }
        
        return allTasks;
    }

    /**
     * Check if a task is an Ant task (by looking at command or args).
     */
    private isAntTask(task: AntTaskConfig): boolean {
        if (!task.command) {return false;}
        const cmd = task.command.toLowerCase();
        if (cmd.includes('ant')) {return true;}
        if (task.args && task.args.some(arg => arg.includes('-f') || arg.endsWith('.xml'))) {
            return true;
        }
        return false;
    }

    /**
     * Parse an Ant task to extract build file, targets, and settings from standard VS Code task properties.
     */
    parseAntTask(task: AntTaskConfig): AntTaskConfig {
        const parsed: AntTaskConfig = { ...task };
        parsed.targets = [];
        // Preserve _workspaceFolder if it exists
        if ((task as any)._workspaceFolder) {
            (parsed as any)._workspaceFolder = (task as any)._workspaceFolder;
        }
        
        // Extract from standard VS Code task properties
        parsed.workingDirectory = task.options?.cwd || '';
        parsed.antHome = task.options?.env?.ANT_HOME || '';
        parsed.javaHome = task.options?.env?.JAVA_HOME || '';
        parsed.shell = task.options?.shell?.executable ? path.basename(task.options.shell.executable) : 'default';

        if (!task.args) {return parsed;}

        const additionalArgsList: string[] = [];
        let i = 0;
        while (i < task.args.length) {
            const arg = task.args[i];
            if (arg === '-f' && i + 1 < task.args.length) {
                // Keep build file path exactly as stored in args (don't resolve)
                parsed.buildFile = task.args[i + 1];
                i += 2;
            } else if (arg.startsWith('-')) {
                // All arguments starting with - are additional args
                additionalArgsList.push(arg);
                i++;
            } else {
                // Arguments not starting with - are targets
                parsed.targets!.push(arg);
                i++;
            }
        }
        
        // Join additional args with newlines for display in UI
        parsed.additionalArgs = additionalArgsList.join('\n');

        return parsed;
    }

    /**
     * Run a saved task from tasks.json by its label.
     * This is equivalent to running "Run Task" from the command palette.
     */
    async runSavedTask(taskLabel: string, workspaceFolderName?: string): Promise<boolean> {
        // Fetch all tasks defined in the workspace (including tasks.json)
        const allTasks = await vscode.tasks.fetchTasks();
        
        // Find the task by label (and workspace folder if specified)
        let taskToRun = allTasks.find(task => {
            if (task.name !== taskLabel) {
                return false;
            }
            // If workspace folder is specified, match it
            if (workspaceFolderName && task.scope && typeof task.scope === 'object') {
                const taskFolder = task.scope as vscode.WorkspaceFolder;
                return taskFolder.name === workspaceFolderName;
            }
            return true;
        });
        
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
            '$ant'
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
        // Determine the build file path to store in tasks.json
        let relativeBuildFilePath: string;
        
        // If it already contains ${workspaceFolder}, keep it as-is
        if (buildFilePath.includes('${workspaceFolder}')) {
            relativeBuildFilePath = buildFilePath;
        } 
        // If it's a simple relative path (not absolute), keep it as-is (e.g., "build.xml", "../build.xml")
        else if (!path.isAbsolute(buildFilePath)) {
            relativeBuildFilePath = buildFilePath;
        }
        // Only convert absolute paths to workspace-relative
        else {
            relativeBuildFilePath = this.toWorkspaceRelativePath(buildFilePath);
        }
        
        // Resolve for working directory calculation if needed
        const resolvedBuildFilePath = this.resolveWorkspacePath(buildFilePath);
        
        // For working directory, preserve VS Code variables if the user explicitly entered them
        // Only resolve and convert if it's an absolute path without variables
        let relativeCwd: string;
        if (workingDirectory && workingDirectory.includes('${workspaceFolder}')) {
            // User explicitly entered a ${workspaceFolder} variable - preserve it
            relativeCwd = workingDirectory;
        } else {
            const resolvedWorkingDir = workingDirectory ? this.resolveWorkspacePath(workingDirectory) : undefined;
            const cwd = resolvedWorkingDir || path.dirname(resolvedBuildFilePath);
            relativeCwd = this.toWorkspaceRelativePath(cwd);
        }
        
        // For the ant command, if ANT_HOME is set we add it to PATH, so just use 'ant'
        // This avoids issues with ${workspaceFolder} variables in the command path
        let antCommand = 'ant';

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
            problemMatcher: '$ant',
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
            // Use string concatenation to preserve ${workspaceFolder} variables
            const pathSeparator = process.platform === 'win32' ? ';' : ':';
            const dirSeparator = process.platform === 'win32' ? '\\' : '/';
            const pathAdditions: string[] = [];
            if (javaHome) {
                pathAdditions.push(javaHome + dirSeparator + 'bin');
            }
            if (antHome) {
                pathAdditions.push(antHome + dirSeparator + 'bin');
            }
            if (pathAdditions.length > 0) {
                // Use ${env:PATH} syntax for tasks.json to reference existing PATH at runtime
                taskConfig.options!.env['PATH'] = pathAdditions.join(pathSeparator) + pathSeparator + '${env:PATH}';
            }
        }

        // Store additional fields for UI (these will be saved to ant-tasks.json, not tasks.json)
        // We keep them on the object temporarily for the save process
        taskConfig.workingDirectory = this.resolveWorkspacePath(relativeCwd);
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
            // Split by spaces, but respect quoted strings
            const lineArgs = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
            args.push(...lineArgs.map(arg => arg.trim()).filter(arg => arg !== ''));
        }
        
        return args;
    }

    /**
     * Save a new task to tasks.json.
     * @param taskConfig The task configuration to save
     * @param workspaceFolderName Optional name of specific workspace folder (for multi-root)
     */
    async saveTaskToWorkspace(taskConfig: AntTaskConfig, workspaceFolderName?: string): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder open');
        }

        let targetFolder = workspaceFolders[0];
        if (workspaceFolderName) {
            const found = workspaceFolders.find(f => f.name === workspaceFolderName);
            if (found) {
                targetFolder = found;
            }
        }

        const vscodeDir = path.join(targetFolder.uri.fsPath, '.vscode');
        const tasksPath = path.join(vscodeDir, 'tasks.json');

        // Ensure .vscode directory exists
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // Clean task config - remove UI-only properties
        const cleanTaskConfig = this.stripCustomProperties(taskConfig);

        const tasksJson = this.readTasksJson(workspaceFolderName);

        // Check if task with same label already exists - replace it instead of duplicating
        const existingIndex = tasksJson.tasks.findIndex(t => t.label === cleanTaskConfig.label);
        if (existingIndex !== -1) {
            tasksJson.tasks[existingIndex] = cleanTaskConfig;
        } else {
            // Add the new task
            tasksJson.tasks.push(cleanTaskConfig);
        }

        // Write tasks.json
        fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 4), 'utf8');
        
        vscode.window.showInformationMessage(`Ant task saved to ${targetFolder.name}/.vscode/tasks.json`);
    }

    /**
     * Strip UI-only properties from task config for saving to tasks.json.
     */
    private stripCustomProperties(taskConfig: AntTaskConfig): AntTaskConfig {
        const clean = { ...taskConfig };
        delete clean.buildFile;
        delete clean.targets;
        delete clean.workingDirectory;
        delete clean.antHome;
        delete clean.javaHome;
        delete clean.shell;
        delete clean.additionalArgs;
        delete (clean as any)._workspaceFolder;
        return clean;
    }

    /**
     * Update an existing task in tasks.json by label.
     * @param originalLabel The original task label
     * @param taskConfig The new task configuration
     * @param workspaceFolderName Optional name of specific workspace folder (for multi-root)
     */
    async updateTask(originalLabel: string, taskConfig: AntTaskConfig, workspaceFolderName?: string): Promise<void> {
        const tasksPath = this.getTasksJsonPath(workspaceFolderName);
        if (!tasksPath) {
            throw new Error('No workspace folder open');
        }

        // Create a clean task config without UI-only properties for tasks.json
        const cleanTaskConfig = this.stripCustomProperties(taskConfig);

        const tasksJson = this.readTasksJson(workspaceFolderName);
        const index = tasksJson.tasks.findIndex(t => t.label === originalLabel);
        
        if (index === -1) {
            throw new Error(`Task "${originalLabel}" not found`);
        }

        tasksJson.tasks[index] = cleanTaskConfig;
        fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 4), 'utf8');
        
        vscode.window.showInformationMessage(`Task "${taskConfig.label}" updated`);
    }

    /**
     * Delete a task from tasks.json by label.
     * @param label The task label to delete
     * @param workspaceFolderName Optional name of specific workspace folder (for multi-root)
     */
    async deleteTask(label: string, workspaceFolderName?: string): Promise<void> {
        const tasksPath = this.getTasksJsonPath(workspaceFolderName);
        if (!tasksPath) {
            throw new Error('No workspace folder open');
        }

        const tasksJson = this.readTasksJson(workspaceFolderName);
        const index = tasksJson.tasks.findIndex(t => t.label === label);
        
        if (index === -1) {
            throw new Error(`Task "${label}" not found`);
        }

        tasksJson.tasks.splice(index, 1);
        fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 4), 'utf8');
        
        vscode.window.showInformationMessage(`Task "${label}" deleted`);
    }
}
