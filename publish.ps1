<#
.SYNOPSIS
    Package and publish the Task Studio extension to the VS Code Marketplace and OpenVSX.
.DESCRIPTION
    Builds the extension in production mode, packages it as a .vsix, and publishes
    that same .vsix to the VS Code Marketplace (via vsce) and OpenVSX (via ovsx).
    Tokens are read from the environment variables VSCE_PAT and OVSX_PAT; vsce and
    ovsx pick them up themselves, so they never appear on a command line.
.PARAMETER SkipMarketplace
    Skip publishing to the VS Code Marketplace.
.PARAMETER SkipOpenVSX
    Skip publishing to OpenVSX.
.PARAMETER DryRun
    Package only, do not publish anywhere.
.PARAMETER Force
    Do not ask for confirmation when there are uncommitted changes (for non-interactive use).
.EXAMPLE
    .\publish.ps1
    .\publish.ps1 -DryRun
    .\publish.ps1 -SkipOpenVSX
#>
param(
    [switch]$SkipMarketplace,
    [switch]$SkipOpenVSX,
    [switch]$DryRun,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# --- Read version from package.json ---
$pkg = Get-Content .\package.json -Raw | ConvertFrom-Json
$version = $pkg.version
$name = $pkg.name
$vsixFile = "$name-$version.vsix"

Write-Host ''
Write-Host '========================================' -ForegroundColor Cyan
Write-Host "  Task Studio publish - v$version" -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan
Write-Host ''

# --- Pre-flight checks ---
$null = & npx --no-install @vscode/vsce --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: @vscode/vsce not found. Run: npm install' -ForegroundColor Red
    exit 1
}

if (-not $SkipOpenVSX -and -not $DryRun) {
    $null = & npx --no-install ovsx --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'WARNING: ovsx not found. Run: npm install' -ForegroundColor Yellow
        Write-Host '         Skipping OpenVSX publish.' -ForegroundColor Yellow
        Write-Host ''
        $SkipOpenVSX = $true
    }
}

# The optional Java Ant parser ships inside the .vsix (java/target is not in git).
if (-not (Test-Path '.\java\target\ant-parser.jar')) {
    Write-Host 'ERROR: java\target\ant-parser.jar not found; it is shipped in the .vsix.' -ForegroundColor Red
    Write-Host '       Build it with: mvn -f java\pom.xml package' -ForegroundColor Gray
    exit 1
}

# --- Check tokens (unless dry run) ---
if (-not $DryRun) {
    if (-not $SkipMarketplace -and -not $env:VSCE_PAT) {
        Write-Host 'ERROR: VSCE_PAT environment variable not set.' -ForegroundColor Red
        Write-Host '       Set it with: $env:VSCE_PAT = "your-token"' -ForegroundColor Red
        Write-Host '       Get a token at: https://dev.azure.com (Personal Access Tokens, Marketplace scope)' -ForegroundColor Gray
        exit 1
    }
    if (-not $SkipOpenVSX -and -not $env:OVSX_PAT) {
        Write-Host 'ERROR: OVSX_PAT environment variable not set.' -ForegroundColor Red
        Write-Host '       Set it with: $env:OVSX_PAT = "your-token"' -ForegroundColor Red
        Write-Host '       Get a token at: https://open-vsx.org/user-settings/tokens' -ForegroundColor Gray
        exit 1
    }
}

# --- Check for uncommitted changes ---
$gitStatus = git status --porcelain 2>$null
if ($gitStatus) {
    Write-Host 'WARNING: You have uncommitted changes:' -ForegroundColor Yellow
    $gitStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host ''
    if (-not $Force) {
        $confirm = Read-Host 'Continue anyway? (y/N)'
        if ($confirm -ne 'y') {
            Write-Host 'Aborted.' -ForegroundColor Red
            exit 1
        }
    }
}

# --- Package (vscode:prepublish runs the production webpack build) ---
Write-Host "[1/3] Packaging $vsixFile ..." -ForegroundColor Green
& npx --no-install @vscode/vsce package --no-git-tag-version --out $vsixFile
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ERROR: vsce package failed.' -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $vsixFile)) {
    Write-Host "ERROR: Expected $vsixFile not found after packaging." -ForegroundColor Red
    exit 1
}

$sizeKB = [math]::Round((Get-Item $vsixFile).Length / 1024)
Write-Host "      Packaged: $vsixFile ($sizeKB KB)" -ForegroundColor Gray
Write-Host ''

if ($DryRun) {
    Write-Host "[DRY RUN] Skipping publish. File ready: $vsixFile" -ForegroundColor Yellow
    exit 0
}

# --- Publish to VS Code Marketplace ---
if (-not $SkipMarketplace) {
    Write-Host '[2/3] Publishing to VS Code Marketplace ...' -ForegroundColor Green
    & npx --no-install @vscode/vsce publish --packagePath $vsixFile
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: VS Code Marketplace publish failed.' -ForegroundColor Red
        exit 1
    }
    Write-Host '      VS Code Marketplace: OK' -ForegroundColor Gray
    Write-Host ''
} else {
    Write-Host '[2/3] Skipping VS Code Marketplace.' -ForegroundColor Yellow
    Write-Host ''
}

# --- Publish to OpenVSX ---
if (-not $SkipOpenVSX) {
    Write-Host '[3/3] Publishing to OpenVSX ...' -ForegroundColor Green
    & npx --no-install ovsx publish $vsixFile
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERROR: OpenVSX publish failed.' -ForegroundColor Red
        exit 1
    }
    Write-Host '      OpenVSX: OK' -ForegroundColor Gray
    Write-Host ''
} else {
    Write-Host '[3/3] Skipping OpenVSX.' -ForegroundColor Yellow
    Write-Host ''
}

# --- Done ---
Write-Host '========================================' -ForegroundColor Green
Write-Host "  v$version published successfully!" -ForegroundColor Green
Write-Host '========================================' -ForegroundColor Green
Write-Host ''
