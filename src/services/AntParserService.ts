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
        
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        // ${workspaceFolder:NAME} (multi-root) and ${workspaceFolder} (first folder)
        value = value.replace(/\$\{workspaceFolder:([^}]+)\}/g, (match, name: string) =>
            workspaceFolders.find(f => f.name === name)?.uri.fsPath ?? match);
        if (workspaceFolders.length > 0) {
            value = value.replace(/\$\{workspaceFolder\}/g, () => workspaceFolders[0].uri.fsPath);
        }
        // ${env:NAME}
        value = value.replace(/\$\{env:([^}]+)\}/g, (_m, name: string) => process.env[name] ?? '');
        return path.normalize(value);
    }

    /** Value of an XML attribute in an attribute list (whole-word match, so `if` does not match `unless`'s value). */
    private static attr(attrs: string, name: string): string | undefined {
        const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
        return m ? (m[1] ?? m[2]) : undefined;
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

        const config = vscode.workspace.getConfiguration('apacheAntManager');
        const useJavaParser = config.get<boolean>('useJavaParser') ?? false;

        // Use Java parser only if explicitly configured
        if (useJavaParser) {
            try {
                console.log('Parsing script with Java Ant Parser');
                const buildInfo = await this.parseWithJava(buildFilePath);
                this.cache.set(buildFilePath, { info: buildInfo, timestamp: Date.now() });
                console.log('Ant script parsed with the Java Ant Parser');
                return buildInfo;
            } catch (error) {
                console.warn('Java parser failed, falling back to XML parsing:', error);
            }
        }

        // Use fast XML parser (default)
        console.log('Parsing script with XML Parser');
        const buildInfo = await this.parseWithXml(buildFilePath);
        this.cache.set(buildFilePath, { info: buildInfo, timestamp: Date.now() });
        return buildInfo;
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
        const config = vscode.workspace.getConfiguration('apacheAntManager');
        const maxDepth = config.get<number>('importDepth') ?? 2;
        
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
        
        // Parse the main file and follow imports up to maxDepth
        await this.parseXmlFile(buildFilePath, buildInfo, processedFiles, fs, 0, maxDepth);

        // Sort targets alphabetically
        buildInfo.targets.sort((a, b) => a.name.localeCompare(b.name));

        return buildInfo;
    }

    /**
     * Parse a single XML file and recursively follow imports/includes.
     * This is a fallback solution in case the Java parser failed.
     * @param currentDepth Current depth level (0 = main file)
     * @param maxDepth Maximum depth to follow imports
     */
    private async parseXmlFile(
        filePath: string, 
        buildInfo: AntBuildInfo, 
        processedFiles: Set<string>,
        fs: any,
        currentDepth: number,
        maxDepth: number
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
                const name = AntParserService.attr(attrs, 'name');
                const def = AntParserService.attr(attrs, 'default');
                const basedir = AntParserService.attr(attrs, 'basedir');

                if (name !== undefined) {buildInfo.projectName = name;}
                if (def !== undefined) {buildInfo.defaultTarget = def;}
                if (basedir !== undefined) {buildInfo.baseDir = path.resolve(fileDir, basedir);}
            }
        }

        // Parse targets
        // Opening tags only: matching a body up to </target> would let a self-closing
        // <target .../> swallow the next target. Ant targets never nest.
        const targetRegex = /<target\b([^>]*?)\/?>/gi;
        let targetMatch;

        while ((targetMatch = targetRegex.exec(content)) !== null) {
            const attrs = targetMatch[1];
            const targetName = AntParserService.attr(attrs, 'name');

            if (targetName) {
                // Skip if target with same name already exists (imported targets can be overridden)
                if (buildInfo.targets.some(t => t.name === targetName)) {
                    continue;
                }

                const depends = AntParserService.attr(attrs, 'depends');
                buildInfo.targets.push({
                    name: targetName,
                    description: AntParserService.attr(attrs, 'description') ?? null,
                    dependencies: depends ? depends.split(',').map(d => d.trim()).filter(Boolean) : [],
                    ifCondition: AntParserService.attr(attrs, 'if') ?? null,
                    unlessCondition: AntParserService.attr(attrs, 'unless') ?? null,
                    isDefault: targetName === buildInfo.defaultTarget
                });
            }
        }

        // Find and process imports and includes (only if we haven't reached max depth)
        if (currentDepth < maxDepth) {
            const importRegex = /<(?:import|include)\s+([^>]*)\/?>/gi;
            let importMatch;

            while ((importMatch = importRegex.exec(content)) !== null) {
                const attrs = importMatch[1];
                let importPath = AntParserService.attr(attrs, 'file');

                // Ant properties (${basedir}, ${ant.file.x}) cannot be resolved without Ant; skip those imports.
                if (importPath && !importPath.includes('${')) {
                    
                    // Resolve relative paths
                    if (!path.isAbsolute(importPath)) {
                        importPath = path.resolve(fileDir, importPath);
                    }

                    // Recursively parse the imported file with incremented depth
                    await this.parseXmlFile(importPath, buildInfo, processedFiles, fs, currentDepth + 1, maxDepth);
                }
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
