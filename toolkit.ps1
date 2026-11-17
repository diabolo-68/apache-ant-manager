<#
.SYNOPSIS
    Task Studio Developer Toolkit - interactive menu for testing, building, and publishing.
.DESCRIPTION
    Displays a menu to run the unit, integration and Playwright E2E tests, view results,
    regenerate the README screenshots, compile, package and publish the extension.
    Package and publish actions delegate to publish.ps1.
.EXAMPLE
    .\toolkit.ps1
#>

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# =====================================================================
#  Display helpers
# =====================================================================

function Get-Version {
    # Re-read every time the menu is drawn, so a version bump shows up without a restart.
    (Get-Content .\package.json -Raw | ConvertFrom-Json).version
}

function Show-Header {
    Clear-Host
    $title = "Task Studio Developer Toolkit  v$(Get-Version)"
    $width = [math]::Max(42, $title.Length + 6)
    $pad = $width - $title.Length
    $left = [math]::Floor($pad / 2)
    Write-Host ''
    Write-Host ('  +' + ('=' * $width) + '+') -ForegroundColor Cyan
    Write-Host ('  |' + (' ' * $left) + $title + (' ' * ($pad - $left)) + '|') -ForegroundColor Cyan
    Write-Host ('  +' + ('=' * $width) + '+') -ForegroundColor Cyan
    Write-Host ''
}

function Show-Menu {
    Write-Host '  -- Tests ------------------------------------' -ForegroundColor DarkGray
    Write-Host '   1  Run unit tests (mocha)' -ForegroundColor White
    Write-Host '   2  Run integration tests (VS Code)' -ForegroundColor White
    Write-Host '   3  Run Playwright E2E tests (all)' -ForegroundColor White
    Write-Host '   4  Run single Playwright E2E test' -ForegroundColor White
    Write-Host ''
    Write-Host '  -- Results ----------------------------------' -ForegroundColor DarkGray
    Write-Host '   5  View unit / integration test results' -ForegroundColor White
    Write-Host '   6  View Playwright test results' -ForegroundColor White
    Write-Host ''
    Write-Host '  -- Build & Publish --------------------------' -ForegroundColor DarkGray
    Write-Host '   7  Compile the extension' -ForegroundColor White
    Write-Host '   8  Regenerate README screenshots' -ForegroundColor White
    Write-Host '   9  Package .vsix only (dry run)' -ForegroundColor White
    Write-Host '  10  Package & publish to VS Code Marketplace' -ForegroundColor White
    Write-Host '  11  Package & publish to OpenVSX' -ForegroundColor White
    Write-Host '  12  Package & publish to Marketplace + OpenVSX' -ForegroundColor White
    Write-Host ''
    Write-Host '   Q  Quit' -ForegroundColor DarkGray
    Write-Host ''
}

function Wait-ForKeypress {
    Write-Host ''
    Write-Host '  Press any key to return to the menu ...' -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
}

function Write-Banner([string]$Text, [string]$Color = 'Green') {
    Write-Host ''
    Write-Host "  $Text" -ForegroundColor $Color
    Write-Host '  ---------------------------------------------' -ForegroundColor DarkGray
    Write-Host ''
}

function Write-Result([bool]$Passed, [string]$What) {
    Write-Host ''
    if ($Passed) {
        Write-Host "  $What PASSED." -ForegroundColor Green
    } else {
        Write-Host "  $What FAILED." -ForegroundColor Red
    }
}

# Runs a native command with its output teed to a file. Native tools (git, vscode-test)
# write informational messages to stderr, which $ErrorActionPreference = 'Stop' would
# turn into terminating errors, so relax it for the run. Returns true on exit code 0.
function Invoke-Logged([scriptblock]$Command, [string]$LogFile, [switch]$Append) {
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # Out-Host: otherwise the output becomes part of the function's return value.
        & $Command 2>&1 | Tee-Object -FilePath $LogFile -Append:$Append | Out-Host
        return ($LASTEXITCODE -eq 0)
    } finally {
        $ErrorActionPreference = $savedEAP
    }
}

function Invoke-Step([string]$NpmScript, [string]$ErrorText) {
    npm run $NpmScript | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERROR: $ErrorText" -ForegroundColor Red
        return $false
    }
    return $true
}

# =====================================================================
#  Menu actions
# =====================================================================

# -- 1. Unit tests -----------------------------------------------------

function Invoke-UnitTests {
    Write-Banner 'Running unit tests ...'
    if (-not (Invoke-Step 'compile-tests' 'Compiling the tests failed.')) { return }

    $ok = Invoke-Logged { npx mocha } '.\test-output.txt'
    Write-Result $ok 'Unit tests'
}

# -- 2. Integration tests ---------------------------------------------

function Invoke-IntegrationTests {
    Write-Banner 'Running integration tests in VS Code ...'
    if (-not (Invoke-Step 'pretest' 'Pretest (compile + lint) failed.')) { return }

    $ok = Invoke-Logged { npx vscode-test } '.\test-output.txt'
    Write-Result $ok 'Integration tests'
}

# -- 3. Playwright E2E tests ------------------------------------------

function Invoke-PlaywrightTests {
    Write-Banner 'Running Playwright E2E tests ...'
    if (-not (Invoke-Step 'compile' 'Compilation failed.')) { return }

    $ok = Invoke-Logged { npx playwright test --project=e2e } '.\playwright-output.txt'
    Write-Result $ok 'Playwright tests'
    Write-Host '  HTML report: .\playwright-report\index.html' -ForegroundColor Gray
}

# -- 4. Single Playwright E2E test ------------------------------------

function Invoke-SinglePlaywrightTest {
    Write-Banner 'Run a single Playwright E2E test' 'Cyan'

    Write-Host '  Available test files:' -ForegroundColor White
    Get-ChildItem .\e2e -Filter '*.spec.ts' |
        Where-Object { $_.Name -ne 'screenshots.spec.ts' } |
        ForEach-Object { Write-Host "    - $($_.Name)" -ForegroundColor Gray }
    Write-Host ''

    $filter = Read-Host '  Enter test name filter (e.g. "creates a task")'
    if ([string]::IsNullOrWhiteSpace($filter)) {
        Write-Host '  No filter provided. Cancelled.' -ForegroundColor Yellow
        return
    }

    Write-Banner "Running tests matching: $filter"
    if (-not (Invoke-Step 'compile' 'Compilation failed.')) { return }

    $ok = Invoke-Logged { npx playwright test --project=e2e --grep "$filter" --reporter=list } '.\playwright-output.txt'
    Write-Result $ok 'Test(s)'
}

# -- 5. Unit / integration results -----------------------------------

function Show-TestResults {
    Write-Banner 'Unit / Integration Test Results (last run)' 'Cyan'

    if (Test-Path '.\test-output.txt') {
        Get-Content '.\test-output.txt'
    } else {
        Write-Host '  No results found. Run the unit or integration tests first (option 1 or 2).' -ForegroundColor Yellow
    }
}

# -- 6. Playwright results --------------------------------------------

function Show-PlaywrightResults {
    Write-Banner 'Playwright E2E Test Results' 'Cyan'

    if (Test-Path '.\playwright-report\index.html') {
        Write-Host '  Opening Playwright HTML report in browser (Ctrl+C to stop the server) ...' -ForegroundColor Green
        npx playwright show-report playwright-report
    } elseif (Test-Path '.\playwright-output.txt') {
        Write-Host '  No HTML report found. Showing console output:' -ForegroundColor Yellow
        Write-Host ''
        Get-Content '.\playwright-output.txt'
    } else {
        Write-Host '  No results found. Run the Playwright tests first (option 3).' -ForegroundColor Yellow
    }
}

# -- 7. Compile --------------------------------------------------------

function Invoke-Compile {
    Write-Banner 'Compiling extension ...'
    if (Invoke-Step 'compile' 'Compilation failed.') {
        Write-Host '  Compilation successful.' -ForegroundColor Green
    }
}

# -- 8. Screenshots ----------------------------------------------------

function Invoke-Screenshots {
    Write-Banner 'Regenerating README screenshots ...'
    Write-Host '  Tip: set $env:E2E_WORKSPACE_ROOT (e.g. C:\demo) so your temp path does not show in the GIF.' -ForegroundColor Gray
    Write-Host ''
    if (Invoke-Step 'screenshots' 'Screenshot run failed.') {
        Write-Host '  Screenshots written to .\docs\screenshots\' -ForegroundColor Green
    }
}

# -- 9-12. Package / publish (delegates to publish.ps1) ---------------

function Invoke-Publish {
    param(
        [switch]$ToMarketplace,
        [switch]$ToOpenVSX
    )

    $publishScript = Join-Path $PSScriptRoot 'publish.ps1'
    if (-not (Test-Path $publishScript)) {
        Write-Host '  ERROR: publish.ps1 not found in project root.' -ForegroundColor Red
        return
    }

    $publishArgs = @{}
    if (-not $ToMarketplace -and -not $ToOpenVSX) {
        Write-Banner 'Packaging .vsix (dry run) ...'
        $publishArgs.DryRun = $true
    } else {
        $targets = @()
        if ($ToMarketplace) { $targets += 'VS Code Marketplace' }
        if ($ToOpenVSX)     { $targets += 'OpenVSX' }
        $targetStr = $targets -join ' + '

        Write-Banner "Package & publish v$(Get-Version) to $targetStr" 'Yellow'
        $confirm = Read-Host "  Publish v$(Get-Version) to $targetStr now? (y/N)"
        if ($confirm -ne 'y') {
            Write-Host '  Cancelled.' -ForegroundColor Yellow
            return
        }
        if (-not $ToMarketplace) { $publishArgs.SkipMarketplace = $true }
        if (-not $ToOpenVSX)     { $publishArgs.SkipOpenVSX = $true }
    }

    # Run in a child PowerShell so publish.ps1's "exit" does not close the toolkit.
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $publishScript)
    foreach ($key in $publishArgs.Keys) { $argList += "-$key" }
    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & powershell.exe @argList
    } finally {
        $ErrorActionPreference = $savedEAP
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host ''
        Write-Host "  publish.ps1 exited with code $LASTEXITCODE." -ForegroundColor Red
    }
}

# =====================================================================
#  Main menu loop
# =====================================================================

while ($true) {
    Show-Header
    Show-Menu

    $choice = Read-Host '  Select an option'

    switch ($choice) {
        '1'  { Invoke-UnitTests;            Wait-ForKeypress }
        '2'  { Invoke-IntegrationTests;     Wait-ForKeypress }
        '3'  { Invoke-PlaywrightTests;      Wait-ForKeypress }
        '4'  { Invoke-SinglePlaywrightTest; Wait-ForKeypress }
        '5'  { Show-TestResults;            Wait-ForKeypress }
        '6'  { Show-PlaywrightResults;      Wait-ForKeypress }
        '7'  { Invoke-Compile;              Wait-ForKeypress }
        '8'  { Invoke-Screenshots;          Wait-ForKeypress }
        '9'  { Invoke-Publish;                               Wait-ForKeypress }
        '10' { Invoke-Publish -ToMarketplace;                Wait-ForKeypress }
        '11' { Invoke-Publish -ToOpenVSX;                    Wait-ForKeypress }
        '12' { Invoke-Publish -ToMarketplace -ToOpenVSX;     Wait-ForKeypress }
        { $_ -in 'q', 'Q' } {
            Write-Host ''
            Write-Host '  Goodbye!' -ForegroundColor Cyan
            Write-Host ''
            exit 0
        }
        default {
            Write-Host ''
            Write-Host '  Invalid option. Please try again.' -ForegroundColor Yellow
            Start-Sleep -Seconds 1
        }
    }
}
