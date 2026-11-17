// Integration tests: run inside a real VS Code (downloaded to .vscode-test/) against a
// throw-away copy of test-fixtures/workspace, so the repository is never modified.
import { defineConfig } from '@vscode/test-cli';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'task-manager-it-'));
fs.cpSync(path.resolve('test-fixtures/workspace'), workspace, { recursive: true });

export default defineConfig({
    label: 'integration',
    files: 'out/test/integration/**/*.test.js',
    version: process.env.VSCODE_VERSION || 'stable',
    workspaceFolder: workspace,
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    mocha: { ui: 'tdd', timeout: 60000 }
});
