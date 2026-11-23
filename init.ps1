# Session startup for Auth Switcher. No dependencies and no build step, so this only checks the
# toolchain, runs the suite as the smoke test, and prints how to load the extension.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "node is not on PATH; install Node 20+ to run the tests." }
Write-Host "node $(node --version)"

Write-Host "`nSmoke test: npm test"
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test failed - fix this before starting a feature." }

Write-Host "`nLoad unpacked: chrome://extensions > Developer mode > Load unpacked > $PSScriptRoot"
Write-Host "Ledger: FEATURES.json  |  Plan: docs/sdlc/bulk-link/plan.md"
