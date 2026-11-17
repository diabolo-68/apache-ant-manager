import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests drive a real VS Code window (see e2e/vscode.ts).
 * Each test gets its own VS Code instance and workspace copy, so tests run one at a time.
 */
export default defineConfig({
    testDir: 'e2e',
    timeout: 120_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: { trace: 'retain-on-failure' },
    projects: [
        { name: 'e2e', testMatch: /.*\.spec\.ts$/, testIgnore: /screenshots\.spec\.ts$/ },
        { name: 'screenshots', testMatch: /screenshots\.spec\.ts$/ }
    ]
});
