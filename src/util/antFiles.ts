import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Check if a file is an Apache Ant build file by looking for DOCTYPE or project element.
 */
export async function isAntBuildFile(filePath: string): Promise<boolean> {
    try {
        // Read just the first portion of the file (enough to find DOCTYPE/project element)
        const handle = await fs.promises.open(filePath, 'r');
        try {
            const buffer = Buffer.alloc(2048);
            const { bytesRead } = await handle.read(buffer, 0, 2048, 0);
            const content = buffer.toString('utf8', 0, bytesRead);
            return /<!DOCTYPE\s+project\b/i.test(content) ||
                /<project\b[^>]*\bxmlns\s*=\s*["']antlib:/i.test(content) ||
                /<project\b[^>]*\bdefault\s*=/i.test(content) ||
                /<project\b[^>]*\bbasedir\s*=/i.test(content);
        } finally {
            await handle.close();
        }
    } catch {
        return false;
    }
}

const EXCLUDE_GLOB = '**/{node_modules,.git,.svn,target,bin,dist,out,.vscode-test}/**';

/**
 * Find Ant build files in the workspace. Ant files can have any name,
 * so every XML file is sniffed for a <project> root.
 */
export async function findAntBuildFiles(token?: vscode.CancellationToken): Promise<vscode.Uri[]> {
    const candidates = await vscode.workspace.findFiles('**/*.xml', EXCLUDE_GLOB, 2000, token);
    const checks = await Promise.all(candidates.map(async uri => (await isAntBuildFile(uri.fsPath)) ? uri : undefined));
    const result = checks.filter((u): u is vscode.Uri => !!u);
    // build.xml first, then alphabetical by path
    return result.sort((a, b) => {
        const aBuild = path.basename(a.fsPath).toLowerCase() === 'build.xml' ? 0 : 1;
        const bBuild = path.basename(b.fsPath).toLowerCase() === 'build.xml' ? 0 : 1;
        return aBuild - bBuild || a.fsPath.localeCompare(b.fsPath);
    });
}

/**
 * Short, human-friendly version of a task's build file path:
 * strips `${workspaceFolder}` / `${workspaceFolder:NAME}` or makes an absolute path
 * relative to its workspace folder.
 */
export function displayBuildFile(rawPath: string | undefined): string {
    if (!rawPath) { return 'Unknown build file'; }
    const stripped = rawPath.replace(/^\$\{workspaceFolder(?::[^}]+)?\}[\\/]?/, '');
    if (stripped !== rawPath) { return stripped || path.basename(rawPath); }
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(rawPath));
    if (folder) {
        return path.relative(folder.uri.fsPath, rawPath);
    }
    return rawPath;
}
