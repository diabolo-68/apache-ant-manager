import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';
import { AntBuildInfo } from '../types/antTypes';

/**
 * Service for parsing Ant build files using the Java parser component.
 */
export class AntParserService {
    private jarPath: string;
    private cache: Map<string, { info: AntBuildInfo; timestamp: number }> = new Map();
    private readonly cacheTimeout = 30000; // 30 seconds

    constructor(private context: vscode.ExtensionContext) {
        this.jarPath = path.join(context.extensionPath, 'java', 'target', 'ant-parser.jar');
    }

    /**
     * Resolve VS Code variables like ${workspaceFolder} in a path.
     */
    private resolveVariables(value: string): string {
        if (!value) {
            return value;
        }
        
        // Resolve ${workspaceFolder}
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            value = value.replace(/\$\{workspaceFolder\}/g, workspaceFolders[0].uri.fsPath);
        }
        
        return value;
    }

    /**
     * Parse an Ant build file and return target information.
     */
    async parseBuildFile(buildFilePath: string): Promise<AntBuildInfo> {
        // Check cache first
        const cached = this.cache.get(buildFilePath);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.info;
        }

        // Try Java parser first, fall back to XML parsing
        try {
            console.log('Parsing script with Java Ant Parser');
            const buildInfo = await this.parseWithJava(buildFilePath);
            this.cache.set(buildFilePath, { info: buildInfo, timestamp: Date.now() });
            console.log('Ant script parsed with the Java Ant Parser');
            return buildInfo;
        } catch (error) {
            console.warn('Java parser failed, falling back to XML parsing:', error);
            const buildInfo = await this.parseWithXml(buildFilePath);
            this.cache.set(buildFilePath, { info: buildInfo, timestamp: Date.now() });
            return buildInfo;
        }
    }

    /**
     * Parse using the Java Ant parser component.
     */
    private async parseWithJava(buildFilePath: string): Promise<AntBuildInfo> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('apacheAntManager');
            // Get configured paths and resolve any VS Code variables
            const javaHomeRaw = config.get<string>('javaHome') || process.env.JAVA_HOME || '';
            const antHomeRaw = config.get<string>('antHome') || process.env.ANT_HOME || '';
            const javaHome = this.resolveVariables(javaHomeRaw);
            const antHome = this.resolveVariables(antHomeRaw);
            const javaPath = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';

            // Build environment with ANT_HOME and JAVA_HOME (resolved paths)
            const env: NodeJS.ProcessEnv = { ...process.env };
            if (antHome) {
                env['ANT_HOME'] = antHome;
            }
            if (javaHome) {
                env['JAVA_HOME'] = javaHome;
            }

            // Build classpath including Ant libraries if ANT_HOME is set
            const classpathParts: string[] = [this.jarPath];
            if (antHome) {
                const antLibPath = path.join(antHome, 'lib', '*');
                classpathParts.push(antLibPath);
            }
            const classpath = classpathParts.join(path.delimiter);

            const child = cp.spawn(javaPath, ['-cp', classpath, 'com.vscode.ant.AntParser', buildFilePath], {
                cwd: path.dirname(buildFilePath),
                env: env
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            child.on('close', (code: number) => {
                if (code !== 0) {
                    reject(new Error(`Java parser exited with code ${code}: ${stderr}`));
                    return;
                }

                try {
                    const buildInfo = JSON.parse(stdout) as AntBuildInfo;
                    resolve(buildInfo);
                } catch (e) {
                    reject(new Error(`Failed to parse JSON output: ${e}`));
                }
            });

            child.on('error', (err: Error) => {
                reject(err);
            });
        });
    }

    /**
     * Fallback XML parsing without Java.
     * Follows import and include elements to find all targets.
     */
    private async parseWithXml(buildFilePath: string): Promise<AntBuildInfo> {
        const fs = require('fs').promises;
        
        const buildInfo: AntBuildInfo = {
            projectName: '',
            defaultTarget: '',
            baseDir: path.dirname(buildFilePath),
            description: null,
            buildFile: buildFilePath,
            targets: []
        };

        // Track processed files to avoid circular imports
        const processedFiles = new Set<string>();
        
        // Parse the main file and follow imports
        await this.parseXmlFile(buildFilePath, buildInfo, processedFiles, fs);

        // Sort targets alphabetically
        buildInfo.targets.sort((a, b) => a.name.localeCompare(b.name));

        return buildInfo;
    }

    /**
     * Parse a single XML file and recursively follow imports/includes.
     * This is a fallback solution in case the Java parser failed.
     */
    private async parseXmlFile(
        filePath: string, 
        buildInfo: AntBuildInfo, 
        processedFiles: Set<string>,
        fs: any
    ): Promise<void> {
        // Normalize path and check if already processed
        const normalizedPath = path.resolve(filePath);
        if (processedFiles.has(normalizedPath)) {
            return;
        }
        processedFiles.add(normalizedPath);

        let content: string;
        try {
            content = await fs.readFile(normalizedPath, 'utf8');
        } catch (error) {
            console.warn(`Failed to read imported file: ${normalizedPath}`);
            return;
        }

        const fileDir = path.dirname(normalizedPath);

        // Parse project attributes only from the main build file
        if (processedFiles.size === 1) {
            const projectMatch = content.match(/<project\s+([^>]*)>/i);
            if (projectMatch) {
                const attrs = projectMatch[1];
                const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
                const defaultMatch = attrs.match(/default\s*=\s*["']([^"']*)["']/i);
                const basedirMatch = attrs.match(/basedir\s*=\s*["']([^"']*)["']/i);

                if (nameMatch) {buildInfo.projectName = nameMatch[1];}
                if (defaultMatch) {buildInfo.defaultTarget = defaultMatch[1];}
                if (basedirMatch) {buildInfo.baseDir = path.resolve(fileDir, basedirMatch[1]);}
            }
        }

        // Parse targets
        const targetRegex = /<target\s+([^>]*)(?:\/>|>[\s\S]*?<\/target>)/gi;
        let targetMatch;

        while ((targetMatch = targetRegex.exec(content)) !== null) {
            const attrs = targetMatch[1];
            const nameMatch = attrs.match(/name\s*=\s*["']([^"']*)["']/i);
            
            if (nameMatch) {
                const targetName = nameMatch[1];
                
                // Skip if target with same name already exists (imported targets can be overridden)
                if (buildInfo.targets.some(t => t.name === targetName)) {
                    continue;
                }

                const descMatch = attrs.match(/description\s*=\s*["']([^"']*)["']/i);
                const dependsMatch = attrs.match(/depends\s*=\s*["']([^"']*)["']/i);
                const ifMatch = attrs.match(/if\s*=\s*["']([^"']*)["']/i);
                const unlessMatch = attrs.match(/unless\s*=\s*["']([^"']*)["']/i);

                buildInfo.targets.push({
                    name: targetName,
                    description: descMatch ? descMatch[1] : null,
                    dependencies: dependsMatch ? dependsMatch[1].split(',').map(d => d.trim()) : [],
                    ifCondition: ifMatch ? ifMatch[1] : null,
                    unlessCondition: unlessMatch ? unlessMatch[1] : null,
                    isDefault: targetName === buildInfo.defaultTarget
                });
            }
        }

        // Find and process imports and includes
        const importRegex = /<(?:import|include)\s+([^>]*)\/?>/gi;
        let importMatch;

        while ((importMatch = importRegex.exec(content)) !== null) {
            const attrs = importMatch[1];
            const fileAttrMatch = attrs.match(/file\s*=\s*["']([^"']*)["']/i);
            
            if (fileAttrMatch) {
                let importPath = fileAttrMatch[1];
                
                // Resolve relative paths
                if (!path.isAbsolute(importPath)) {
                    importPath = path.resolve(fileDir, importPath);
                }

                // Recursively parse the imported file
                await this.parseXmlFile(importPath, buildInfo, processedFiles, fs);
            }
        }
    }

    /**
     * Clear the cache for a specific file or all files.
     */
    clearCache(buildFilePath?: string): void {
        if (buildFilePath) {
            this.cache.delete(buildFilePath);
        } else {
            this.cache.clear();
        }
    }
}
