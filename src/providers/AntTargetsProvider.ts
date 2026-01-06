import * as vscode from 'vscode';
import * as path from 'path';
import { AntParserService } from '../services/AntParserService';
import { AntBuildInfo, AntTarget } from '../types/antTypes';

/**
 * Tree data provider for displaying Ant targets in the explorer.
 * Files are only parsed when expanded, not on initialization.
 */
export class AntTargetsProvider implements vscode.TreeDataProvider<AntTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AntTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<AntTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AntTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private buildFiles: string[] = [];
    private parsedBuildFiles: Map<string, AntBuildInfo> = new Map();

    constructor(private parserService: AntParserService) {
        this.discoverBuildFiles();
    }

    refresh(): void {
        this.buildFiles = [];
        this.parsedBuildFiles.clear();
        this.parserService.clearCache();
        this.discoverBuildFiles();
        this._onDidChangeTreeData.fire();
    }

    private async discoverBuildFiles(): Promise<void> {
        // Only find files, don't parse them
        const files = await vscode.workspace.findFiles('**/build.xml', '**/node_modules/**');
        this.buildFiles = files.map(f => f.fsPath);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AntTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AntTreeItem): Promise<AntTreeItem[]> {
        if (!element) {
            // Root level: show build files (without parsing them)
            const items: AntTreeItem[] = [];
            
            for (const filePath of this.buildFiles) {
                const item = new AntTreeItem(
                    path.basename(path.dirname(filePath)) + '/build.xml',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'buildFile',
                    filePath
                );
                item.tooltip = filePath;
                item.iconPath = new vscode.ThemeIcon('file-code');
                item.contextValue = 'antBuildFile';
                items.push(item);
            }

            return items;
        }

        if (element.type === 'buildFile' && element.buildFilePath) {
            // Parse on-demand when the build file is expanded
            let buildInfo = this.parsedBuildFiles.get(element.buildFilePath);
            
            if (!buildInfo) {
                try {
                    buildInfo = await this.parserService.parseBuildFile(element.buildFilePath);
                    this.parsedBuildFiles.set(element.buildFilePath, buildInfo);
                } catch (error) {
                    console.error(`Failed to parse ${element.buildFilePath}:`, error);
                    return [new AntTreeItem(
                        `Error: ${error instanceof Error ? error.message : 'Failed to parse'}`,
                        vscode.TreeItemCollapsibleState.None,
                        'error',
                        element.buildFilePath
                    )];
                }
            }

            return buildInfo.targets.map(target => {
                const item = new AntTreeItem(
                    target.name,
                    vscode.TreeItemCollapsibleState.None,
                    'target',
                    element.buildFilePath,
                    target
                );

                item.tooltip = target.description || target.name;
                item.iconPath = target.isDefault 
                    ? new vscode.ThemeIcon('star-full') 
                    : new vscode.ThemeIcon('symbol-method');
                item.contextValue = 'antTarget';
                
                // Make target runnable on click
                item.command = {
                    command: 'apache-ant-manager.runSingleTarget',
                    title: 'Run Target',
                    arguments: [element.buildFilePath, target.name]
                };

                return item;
            });
        }

        return [];
    }
}

/**
 * Tree item for Ant build files and targets.
 */
export class AntTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: 'buildFile' | 'target' | 'error',
        public readonly buildFilePath?: string,
        public readonly target?: AntTarget
    ) {
        super(label, collapsibleState);
    }
}
