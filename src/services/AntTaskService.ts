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
    // Parsed fields for UI
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
     * Convert an absolute path to a workspace-relative path using ${workspaceFolder:NAME}.
     * Checks all workspace folders and returns the relative path for the matching one.
     * Returns the original path if it's not within any workspace folder.
     */
    private toWorkspaceRelativePath(absolutePath: string): string {
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
     * Get the path to the workspace tasks.json file.
     */
    private getTasksJsonPath(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return path.join(workspaceFolders[0].uri.fsPath, '.vscode', 'tasks.json');
    }

    /**
     * Read all tasks from tasks.json.
     */
    readTasksJson(): { version: string; tasks: AntTaskConfig[] } {
        const tasksPath = this.getTasksJsonPath();
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
     * Get all Ant-related tasks from tasks.json.
     */
    getAntTasks(): AntTaskConfig[] {
        const tasksJson = this.readTasksJson();
        return tasksJson.tasks.filter(task => this.isAntTask(task));
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
     * Parse an Ant task to extract build file, targets, and additional arguments.
     */
    parseAntTask(task: AntTaskConfig): AntTaskConfig {
        const parsed: AntTaskConfig = { ...task };
        parsed.targets = [];
        // Resolve workspace-relative paths to absolute paths
        parsed.workingDirectory = this.resolveWorkspacePath(task.options?.cwd || '');
        parsed.antHome = task.options?.env?.ANT_HOME || '';
        parsed.javaHome = task.options?.env?.JAVA_HOME || '';
        parsed.shell = this.detectShellFromConfig(task);

        if (!task.args) {return parsed;}

        const additionalArgsList: string[] = [];
        let i = 0;
        while (i < task.args.length) {
            const arg = task.args[i];
            if (arg === '-f' && i + 1 < task.args.length) {
                // Resolve workspace-relative build file path
                parsed.buildFile = this.resolveWorkspacePath(task.args[i + 1]);
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
        
        // Join additional arguments with newlines for display in textarea
        parsed.additionalArgs = additionalArgsList.join('\n');

        return parsed;
    }

    /**
     * Run a saved task from tasks.json by its label.
     * This is equivalent to running "Run Task" from the command palette.
     */
    async runSavedTask(taskLabel: string): Promise<boolean> {
        // Fetch all tasks defined in the workspace (including tasks.json)
        const allTasks = await vscode.tasks.fetchTasks();
        
        // Find the task by label
        const taskToRun = allTasks.find(task => task.name === taskLabel);
        
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
        const relativeBuildFilePath = this.toWorkspaceRelativePath(buildFilePath);
        const relativeCwd = this.toWorkspaceRelativePath(cwd);
        
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
            // Split by spaces, but respect quoted strings
            const lineArgs = line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
            args.push(...lineArgs.map(arg => arg.trim()).filter(arg => arg !== ''));
        }
        
        return args;
    }

    /**
     * Save a new task to tasks.json.
     */
    async saveTaskToWorkspace(taskConfig: AntTaskConfig): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder open');
        }

        const vscodeDir = path.join(workspaceFolders[0].uri.fsPath, '.vscode');
        const tasksPath = path.join(vscodeDir, 'tasks.json');

        // Ensure .vscode directory exists
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        const tasksJson = this.readTasksJson();

        // Add the new task
        tasksJson.tasks.push(taskConfig);

        // Write back
        fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 4), 'utf8');
        
        vscode.window.showInformationMessage('Ant task saved to tasks.json');
    }

    /**
     * Update an existing task in tasks.json by label.
     */
    async updateTask(originalLabel: string, taskConfig: AntTaskConfig): Promise<void> {
        const tasksPath = this.getTasksJsonPath();
        if (!tasksPath) {
            throw new Error('No workspace folder open');
        }

        const tasksJson = this.readTasksJson();
        const index = tasksJson.tasks.findIndex(t => t.label === originalLabel);
        
        if (index === -1) {
            throw new Error(`Task "${originalLabel}" not found`);
        }

        tasksJson.tasks[index] = taskConfig;
        fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 4), 'utf8');
        
        vscode.window.showInformationMessage(`Task "${taskConfig.label}" updated`);
    }

    /**
     * Delete a task from tasks.json by label.
     */
    async deleteTask(label: string): Promise<void> {
        const tasksPath = this.getTasksJsonPath();
        if (!tasksPath) {
            throw new Error('No workspace folder open');
        }

        const tasksJson = this.readTasksJson();
        const index = tasksJson.tasks.findIndex(t => t.label === label);
        
        if (index === -1) {
            throw new Error(`Task "${label}" not found`);
        }

        tasksJson.tasks.splice(index, 1);
        fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 4), 'utf8');
        
        vscode.window.showInformationMessage(`Task "${label}" deleted`);
    }
}
