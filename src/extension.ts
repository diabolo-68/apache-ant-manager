import * as vscode from 'vscode';
import { AntConfigurationPanel, EditContext } from './panels/AntConfigurationPanel';
import { AntTasksListPanel } from './panels/AntTasksListPanel';
import { AntTargetsProvider } from './providers/AntTargetsProvider';
import { AntParserService } from './services/AntParserService';
import { AntTaskService, AntTaskConfig } from './services/AntTaskService';

let antTargetsProvider: AntTargetsProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Apache Ant Manager is now active');

    const parserService = new AntParserService(context);
    const taskService = new AntTaskService();

    // Register the Ant Targets tree view provider
    antTargetsProvider = new AntTargetsProvider(parserService);
    vscode.window.registerTreeDataProvider('antTargets', antTargetsProvider);

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
            buildFilePath = task.buildFile || '';
            
            // Get workspace folder from the task's _workspaceFolder property (set by getAntTasks)
            // or try to parse from the buildFile path
            let originalWorkspaceFolder: string | undefined = (task as any)._workspaceFolder;
            if (!originalWorkspaceFolder && buildFilePath) {
                // Extract workspace folder from ${workspaceFolder:NAME} syntax as fallback
                const match = buildFilePath.match(/\$\{workspaceFolder:([^}]+)\}/);
                if (match) {
                    originalWorkspaceFolder = match[1];
                } else {
                    // Default to first workspace folder
                    const folders = vscode.workspace.workspaceFolders;
                    if (folders && folders.length > 0) {
                        originalWorkspaceFolder = folders[0].name;
                    }
                }
            }
            
            editContext = {
                isEditMode: true,
                originalLabel: task.label,
                originalWorkspaceFolder: originalWorkspaceFolder,
                workspaceFolder: originalWorkspaceFolder,
                task: task,
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
                // If called with a build.xml file, open the editor directly
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

    // Command: Refresh tree view
    const refreshCommand = vscode.commands.registerCommand(
        'apache-ant-manager.refresh',
        () => {
            antTargetsProvider.refresh();
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
