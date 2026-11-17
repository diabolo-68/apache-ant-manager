#!/usr/bin/env node
// publish.js - Package and publish Task Studio to the VS Code Marketplace and OpenVSX
//
// Usage:
//   node publish.js                    # package + publish to both
//   node publish.js --dry-run          # package only
//   node publish.js --skip-openvsx     # skip OpenVSX
//   node publish.js --skip-marketplace # skip Marketplace
//
// Tokens come from VSCE_PAT and OVSX_PAT. vsce and ovsx read them from the
// environment themselves, so they are never put on a command line.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- Parse arguments ---
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipMarketplace = args.includes('--skip-marketplace');
let skipOpenVSX = args.includes('--skip-openvsx');

// --- Helpers ---
// shell: true so that "npx" resolves to npx.cmd on Windows; every argument is a fixed
// string or the package-derived .vsix name, never user input.
function npx(npxArgs, opts) {
    const all = ['--no-install', ...npxArgs];
    if (!opts || opts.stdio !== 'pipe') {
        console.log(`  > npx ${all.join(' ')}`);
    }
    return execFileSync('npx', all, { stdio: 'inherit', cwd: __dirname, shell: true, ...opts });
}

function npxAvailable(pkgName) {
    try {
        npx([pkgName, '--version'], { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

function fail(...lines) {
    lines.forEach(line => console.error(line));
    process.exit(1);
}

function header(text) {
    console.log('\n' + '='.repeat(48));
    console.log('  ' + text);
    console.log('='.repeat(48) + '\n');
}

// --- Read version from package.json ---
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const version = pkg.version;
const vsixFile = `${pkg.name}-${version}.vsix`;
const vsixPath = path.join(__dirname, vsixFile);

header(`Task Studio publish - v${version}`);

// --- Pre-flight checks ---
console.log('[check] Verifying tools...');

if (!npxAvailable('@vscode/vsce')) {
    fail('ERROR: @vscode/vsce not found. Run: npm install');
}

if (!skipOpenVSX && !dryRun && !npxAvailable('ovsx')) {
    console.warn('WARNING: ovsx not found. Run: npm install');
    console.warn('         Skipping OpenVSX publish.\n');
    skipOpenVSX = true;
}

// The optional Java Ant parser ships inside the .vsix (java/target is not in git).
if (!fs.existsSync(path.join(__dirname, 'java', 'target', 'ant-parser.jar'))) {
    fail('ERROR: java/target/ant-parser.jar not found; it is shipped in the .vsix.',
        '       Build it with: mvn -f java/pom.xml package');
}

// --- Check tokens (unless dry run) ---
if (!dryRun) {
    if (!skipMarketplace && !process.env.VSCE_PAT) {
        fail('ERROR: VSCE_PAT environment variable not set.',
            '       Set it with: set VSCE_PAT=your-token',
            '       Or in PowerShell: $env:VSCE_PAT = "your-token"',
            '       Get a token at: https://dev.azure.com (Personal Access Tokens, Marketplace scope)');
    }
    if (!skipOpenVSX && !process.env.OVSX_PAT) {
        fail('ERROR: OVSX_PAT environment variable not set.',
            '       Set it with: set OVSX_PAT=your-token',
            '       Or in PowerShell: $env:OVSX_PAT = "your-token"',
            '       Get a token at: https://open-vsx.org/user-settings/tokens');
    }
}

// --- Check for uncommitted changes (warn only; publish.ps1 asks) ---
try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: __dirname, encoding: 'utf8' }).trim();
    if (status) {
        console.warn('WARNING: You have uncommitted changes:');
        status.split('\n').forEach(line => console.warn('  ' + line));
        console.warn('');
    }
} catch {
    // git not available or not a repo, skip check
}

// --- Package (vscode:prepublish runs the production webpack build) ---
try {
    console.log(`[1/3] Packaging ${vsixFile} ...`);
    npx(['@vscode/vsce', 'package', '--no-git-tag-version', '--out', vsixFile]);
    if (!fs.existsSync(vsixPath)) {
        fail(`ERROR: Expected ${vsixFile} not found after packaging.`);
    }
    const sizeKB = Math.round(fs.statSync(vsixPath).size / 1024);
    console.log(`      Packaged: ${vsixFile} (${sizeKB} KB)\n`);

    if (dryRun) {
        console.log(`[DRY RUN] Skipping publish. File ready: ${vsixFile}`);
        process.exit(0);
    }

    // --- Publish to VS Code Marketplace ---
    if (!skipMarketplace) {
        console.log('[2/3] Publishing to VS Code Marketplace ...');
        npx(['@vscode/vsce', 'publish', '--packagePath', vsixFile]);
        console.log('      VS Code Marketplace: OK\n');
    } else {
        console.log('[2/3] Skipping VS Code Marketplace.\n');
    }

    // --- Publish to OpenVSX ---
    if (!skipOpenVSX) {
        console.log('[3/3] Publishing to OpenVSX ...');
        npx(['ovsx', 'publish', vsixFile]);
        console.log('      OpenVSX: OK\n');
    } else {
        console.log('[3/3] Skipping OpenVSX.\n');
    }
} catch (err) {
    fail(`ERROR: ${err.message.split('\n')[0]}`);
}

// --- Done ---
header(`v${version} published successfully!`);
