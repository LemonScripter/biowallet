#Requires -Version 5.1
<#
.SYNOPSIS
    BioWallet deploy script — SCP + GitHub subtree push

.DESCRIPTION
    Preflight checks:
      1. sw.js CACHE version matches the latest post-PRECACHE-change bump
      2. No staged/unstaged changes in the BioWallet directory
    Deploy:
      3. chattr -i unlock on protected server files
      4. SCP all changed files to /var/www/biowallet/ (correct paths)
      5. chattr +i re-lock on protected server files
      6. Git subtree split → push origin biowallet-deploy:main --force

.PARAMETER SkipGitPush
    SCP only, without subtree push (when GitHub does not need updating)

.PARAMETER SkipPreflight
    Skip preflight checks (emergency deploy only)

.EXAMPLE
    cd C:\Users\lszok\Documents\_MetaSpace_CPU
    .\BioWallet\tools\deploy.ps1

.EXAMPLE
    .\BioWallet\tools\deploy.ps1 -SkipGitPush
#>
param(
    [switch]$SkipGitPush,
    [switch]$SkipPreflight
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Configuration ─────────────────────────────────────────────────────────────
$REPO_ROOT  = "C:\Users\lszok\Documents\_MetaSpace_CPU"
$BW_ROOT    = "$REPO_ROOT\BioWallet"
$SSH_KEY    = "$env:USERPROFILE\.ssh\google_compute_engine"
$SERVER     = "lszok@34.146.249.102"

# Immutable (+i) protected files on the server — unlocked before SCP, re-locked after
$CHATTR_FILES = @(
    "/var/www/biowallet/app/app.js",
    "/var/www/biowallet/app/vault_worker.js",
    "/var/www/biowallet/app/sw.js",
    "/var/www/biowallet/core/vault.js",
    "/var/www/biowallet/core/wallet.js",
    "/var/www/biowallet/core/fuzzy_extractor.js",
    "/var/www/biowallet/core/recovery_formula.js",
    "/var/www/biowallet/checksums.txt"
)

# File → server destination path (src\ relative to BW_ROOT)
$DEPLOY_MAP = [ordered]@{
    "src\app\sw.js"          = "/var/www/biowallet/app/sw.js"   # KRITIKUS: /app/ alkönyvtár!
    "src\app\app.js"         = "/var/www/biowallet/app/app.js"
    "src\app\vault_worker.js"= "/var/www/biowallet/app/vault_worker.js"
    "src\app\index.html"     = "/var/www/biowallet/app/index.html"
    "src\core\vault.js"      = "/var/www/biowallet/core/vault.js"
    "src\core\wallet.js"     = "/var/www/biowallet/core/wallet.js"
    "src\core\wc2.js"        = "/var/www/biowallet/core/wc2.js"
    "src\core\i18n.js"       = "/var/www/biowallet/core/i18n.js"
    "src\core\swap.js"       = "/var/www/biowallet/core/swap.js"
    "src\core\prices.js"     = "/var/www/biowallet/core/prices.js"
    "src\core\fuzzy_extractor.js"   = "/var/www/biowallet/core/fuzzy_extractor.js"
    "src\core\recovery_formula.js" = "/var/www/biowallet/core/recovery_formula.js"
    "src\core\rpc.js"              = "/var/www/biowallet/core/rpc.js"
    "dapp-guide.html"        = "/var/www/biowallet/dapp-guide.html"
    "dapp-guide.js"          = "/var/www/biowallet/dapp-guide.js"
    "checksums.txt"          = "/var/www/biowallet/checksums.txt"
    "recovery_tool.html"     = "/var/www/biowallet/recovery_tool.html"
}

# Files in PRECACHE list — preflight checks these when sw.js changes
$PRECACHE_FILES = @(
    "src\app\app.js", "src\app\vault_worker.js", "src\app\index.html",
    "src\core\vault.js", "src\core\wallet.js", "src\core\wc2.js",
    "src\core\i18n.js", "src\core\swap.js", "src\core\fuzzy_extractor.js", "src\core\rpc.js",
    "src\core\bio_capture.js", "src\core\causal_chain.js", "src\core\recovery_formula.js",
    "dapp-guide.html", "dapp-guide.js", "recovery_tool.html"
)

# ── Helpers ───────────────────────────────────────────────────────────────────
function Write-Step { param($msg) Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok   { param($msg) Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  ERR $msg" -ForegroundColor Red }

# ── Preflight ─────────────────────────────────────────────────────────────────
if (-not $SkipPreflight) {
    Write-Step "PREFLIGHT ELLENŐRZÉSEK"

    # 1. SW verzió olvasása
    $swPath = "$BW_ROOT\src\app\sw.js"
    $swContent = Get-Content $swPath -Raw
    if ($swContent -match "const CACHE = 'biowallet-(v\d+)'") {
        $swVersion = $Matches[1]
        Write-Ok "SW cache: biowallet-$swVersion"
    } else {
        Write-Fail "sw.js: CACHE sor nem található!"
        exit 1
    }

    # 2. SW bump commit hash megkeresése
    $swBumpCommit = git -C $REPO_ROOT log --oneline -- BioWallet/src/app/sw.js |
        Select-Object -First 1
    Write-Ok "Utolsó SW bump: $swBumpCommit"

    # 3. Have PRECACHE files changed since the SW bump?
    $swBumpHash = ($swBumpCommit -split ' ')[0]
    $changedAfterBump = @()
    foreach ($f in $PRECACHE_FILES) {
        $gitPath = "BioWallet/$($f -replace '\\','/')"
        $changed = git -C $REPO_ROOT diff --name-only "${swBumpHash}..HEAD" -- $gitPath
        if ($changed) { $changedAfterBump += $f }
    }

    if ($changedAfterBump.Count -gt 0) {
        Write-Fail "PRECACHE files changed after v$swVersion bump ($swBumpHash):"
        $changedAfterBump | ForEach-Object { Write-Fail "    $_" }
        Write-Fail "-> Bump the SW version, then re-run the deploy!"
        Write-Fail "  (To skip: -SkipPreflight — only if you know what you're doing)"
        exit 1
    } else {
        Write-Ok "No PRECACHE changes since SW bump — OK"
    }

    # 4. Is the working tree clean?
    $dirty = git -C $REPO_ROOT status --short -- BioWallet/
    if ($dirty) {
        Write-Warn "Uncommitted changes in the BioWallet directory:"
        $dirty | ForEach-Object { Write-Warn "    $_" }
        Write-Warn "Continue? (Enter = yes, Ctrl+C = abort) — auto-continues in 5s..."
        Start-Sleep -Seconds 5
    } else {
        Write-Ok "Working tree clean"
    }

    # 5. SSH kulcs megléte
    if (-not (Test-Path $SSH_KEY)) {
        Write-Fail "SSH key not found: $SSH_KEY"
        exit 1
    }
    Write-Ok "SSH kulcs: $SSH_KEY"
}

# ── chattr -i: unlock immutable files before deploy ──────────────────────────
Write-Step "CHATTR -i (unlocking immutable files)"
$unlockCmd = "sudo chattr -i " + ($CHATTR_FILES -join " ")
$sshResult = ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SERVER $unlockCmd 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "chattr -i sikertelen: $sshResult"
    exit 1
}
Write-Ok "Files unlocked (chattr -i)"

# ── SCP Deploy ────────────────────────────────────────────────────────────────
Write-Step "SCP DEPLOY → $SERVER"

$errors = 0
foreach ($entry in $DEPLOY_MAP.GetEnumerator()) {
    $srcFull = Join-Path $BW_ROOT $entry.Key
    $dst     = $entry.Value
    if (-not (Test-Path $srcFull)) {
        Write-Warn "Skipped (not found): $($entry.Key)"
        continue
    }
    Write-Host "  $($entry.Key) → $dst" -NoNewline
    scp -i $SSH_KEY -o StrictHostKeyChecking=no -q "$srcFull" "${SERVER}:${dst}"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail " FAILED"
        $errors++
    } else {
        Write-Ok " OK"
    }
}

if ($errors -gt 0) {
    Write-Fail "$errors file(s) SCP failed — check the connection!"
    # Re-lock what we can before exiting
    ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SERVER ("sudo chattr +i " + ($CHATTR_FILES -join " ")) 2>&1 | Out-Null
    exit 1
}

# ── chattr +i: re-lock immutable files after deploy ──────────────────────────
Write-Step "CHATTR +i (re-locking immutable files)"
$lockCmd = "sudo chattr +i " + ($CHATTR_FILES -join " ")
$sshResult = ssh -i $SSH_KEY -o StrictHostKeyChecking=no $SERVER $lockCmd 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "chattr +i failed: $sshResult"
    Write-Warn "WARNING: Files are NOT locked! Run manually: ssh server 'sudo chattr +i ...'"
    exit 1
}
Write-Ok "Files re-locked (chattr +i)"

# ── GitHub subtree push ───────────────────────────────────────────────────────
if (-not $SkipGitPush) {
    Write-Step "GITHUB SUBTREE PUSH"

    Write-Host "  subtree split in progress..." -NoNewline
    $splitOut = git -C $REPO_ROOT subtree split --prefix=BioWallet -b biowallet-deploy 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail " FAILED`n$splitOut"
        exit 1
    }
    Write-Ok " done"

    Write-Host "  push origin biowallet-deploy:main --force..." -NoNewline
    git -C $REPO_ROOT push origin biowallet-deploy:main --force 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail " FAILED"
        git -C $REPO_ROOT branch -D biowallet-deploy 2>$null
        exit 1
    }
    Write-Ok " done"

    git -C $REPO_ROOT branch -D biowallet-deploy | Out-Null
    Write-Ok "Temp branch deleted"
} else {
    Write-Warn "GitHub push skipped (-SkipGitPush)"
}

Write-Host "`nDeploy complete!" -ForegroundColor Green
