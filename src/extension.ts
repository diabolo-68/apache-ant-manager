import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AntConfigurationPanel, EditContext } from './panels/AntConfigurationPanel';
import { AntTasksListPanel } from './panels/AntTasksListPanel';
import { AntParserService } from './services/AntParserService';
import { AntTaskService, AntTaskConfig } from './services/AntTaskService';

/**
 * Check if a file is an Apache Ant build file by looking for DOCTYPE or project element.
 */
async function isAntBuildFile(filePath: string): Promise<boolean> {
    try {
        // Read just the first portion of the file (enough to find DOCTYPE/project element)
        const buffer = Buffer.alloc(2048);
        const fd = fs.openSync(filePath, 'r');
        const bytesRead = fs.readSync(fd, buffer, 0, 2048, 0);
        fs.closeSync(fd);
        
        const content = buffer.toString('utf8', 0, bytesRead);
        
        // Check for Ant DOCTYPE or project element with xmlns for Ant
        return /<!DOCTYPE\s+project\b/i.test(content) || 
               /<project\b[^>]*\bxmlns\s*=\s*["']antlib:/i.test(content) ||
               /<project\b[^>]*\bdefault\s*=/i.test(content) ||
               /<project\b[^>]*\bbasedir\s*=/i.test(content);
    } catch {
        return false;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Apache Ant Manager is now active');

    const parserService = new AntParserService(context);
    const taskService = new AntTaskService();

    // Helper function to open the task editor
    const openTaskEditor = (task: AntTaskConfig | null, isNew: boolean) => {
        let buildFilePath: string;
        let editContext: EditContext;

        if (isNew || !task) {
            // For new task, prompt for build file
            vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: { 'Ant Build Files': ['xml'] },
                title: 'Select Ant Build File'
            }).then(files => {
                if (files && files.length > 0) {
                    AntConfigurationPanel.createOrShow(
                        context.extensionUri,
                        parserService,
                        taskService,
                        files[0].fsPath,
                        {
                            isEditMode: false,
                            onSaveComplete: () => {
                                AntTasksListPanel.currentPanel?.refresh();
                            }
                        }
                    );
                }
            });
        } else {
            // Edit existing task
            const rawBuildFilePath = task.buildFile || '';
            
            // Get workspace folder from the task (set by getAntTasks)
            const taskWorkspaceFolder = (task as any)._workspaceFolder;
            
            // Resolve the build file path the same way as the refresh button
            let buildFilePath = taskService.resolveWorkspacePath(rawBuildFilePath, taskWorkspaceFolder);
            
            // If it's still a relative path, resolve it relative to working directory
            if (!path.isAbsolute(buildFilePath) && !buildFilePath.startsWith('${')) {
                let workingDir = task.workingDirectory || '';
                if (workingDir) {
                    workingDir = taskService.resolveWorkspacePath(workingDir, taskWorkspaceFolder);
                    buildFilePath = path.resolve(workingDir, buildFilePath);
                }
            }
            
            editContext = {
                isEditMode: true,
                originalLabel: task.label,
                task: task,
                workspaceFolder: taskWorkspaceFolder,
                onSaveComplete: () => {
                    AntTasksListPanel.currentPanel?.refresh();
                }
            };
            
            if (buildFilePath) {
                AntConfigurationPanel.createOrShow(
                    context.extensionUri,
                    parserService,
                    taskService,
                    buildFilePath,
                    editContext
                );
            } else {
                vscode.window.showWarningMessage('Could not determine build file for this task');
            }
        }
    };

    // Command: Open Ant Task Manager (main list view)
    const openConfigurationCommand = vscode.commands.registerCommand(
        'apache-ant-manager.openConfiguration',
        async (uri?: vscode.Uri) => {
            if (uri) {
                // Validate that this is an Ant build file
                const isAntFile = await isAntBuildFile(uri.fsPath);
                if (!isAntFile) {
                    vscode.window.showWarningMessage('This file does not appear to be an Apache Ant build file.');
                    return;
                }
                // Open the editor for this Ant file
                AntConfigurationPanel.createOrShow(
                    context.extensionUri,
                    parserService,
                    taskService,
                    uri.fsPath,
                    { isEditMode: false }
                );
            } else {
                // Otherwise, show the task list
                AntTasksListPanel.createOrShow(
                    context.extensionUri,
                    taskService,
                    parserService,
                    openTaskEditor
                );
            }
        }
    );

    // Command: Select Build File (create new task)
    const selectBuildFileCommand = vscode.commands.registerCommand(
        'apache-ant-manager.selectBuildFile',
        async () => {
            const files = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'Ant Build Files': ['xml']
                },
                title: 'Select Ant Build File'
            });

            if (files && files.length > 0) {
                AntConfigurationPanel.createOrShow(
                    context.extensionUri,
                    parserService,
                    taskService,
                    files[0].fsPath,
                    { isEditMode: false }
                );
            }
        }
    );

    // Command: Run Targets
    const runTargetsCommand = vscode.commands.registerCommand(
        'apache-ant-manager.runTargets',
        async () => {
            // Show quick pick to select from existing Ant tasks
            const tasks = taskService.getAntTasks();
            
            if (tasks.length === 0) {
                vscode.window.showWarningMessage('No Ant tasks configured. Use "Ant: Open Ant Configuration" to create one.');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                tasks.map(t => ({
                    label: t.label,
                    description: taskService.parseAntTask(t).targets?.join(', ') || ''
                })),
                { placeHolder: 'Select an Ant task to run' }
            );

            if (selected) {
                const task = tasks.find(t => t.label === selected.label);
                if (task) {
                    const parsed = taskService.parseAntTask(task);
                    if (parsed.buildFile && parsed.targets) {
                        await taskService.runAntTargets(parsed.buildFile, parsed.targets);
                    }
                }
            }
        }
    );

    // Command: Run single target from tree view
    const runSingleTargetCommand = vscode.commands.registerCommand(
        'apache-ant-manager.runSingleTarget',
        async (buildFilePath: string, targetName: string) => {
            await taskService.runAntTargets(buildFilePath, [targetName]);
        }
    );

    // Command: Refresh
    const refreshCommand = vscode.commands.registerCommand(
        'apache-ant-manager.refresh',
        () => {
            AntTasksListPanel.currentPanel?.refresh();
        }
    );

    context.subscriptions.push(
        openConfigurationCommand,
        selectBuildFileCommand,
        runTargetsCommand,
        runSingleTargetCommand,
        refreshCommand
    );
}

export function deactivate() {
    // Cleanup
}
