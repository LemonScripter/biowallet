#Requires -Version 5.1
<#
.SYNOPSIS
    BioWallet deploy script — SCP + GitHub subtree push

.DESCRIPTION
    Preflight ellenőrzések:
      1. sw.js CACHE verziója megegyezik-e a legutóbbi PRECACHE-módosítás utáni bumppal
      2. Nincsenek-e staged/unstaged változások a BioWallet könyvtárban
    Deploy:
      3. SCP minden érintett fájlt /var/www/biowallet/ alá (helyes útvonalakra)
      4. Git subtree split → push origin biowallet-deploy:main --force

.PARAMETER SkipGitPush
    Csak SCP, subtree push nélkül (ha GitHub-ot nem kell frissíteni)

.PARAMETER SkipPreflight
    Kihagyja az előzetes ellenőrzéseket (vészhelyzeti deploy esetén)

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

# ── Konfiguráció ──────────────────────────────────────────────────────────────
$REPO_ROOT  = "C:\Users\lszok\Documents\_MetaSpace_CPU"
$BW_ROOT    = "$REPO_ROOT\BioWallet"
$SSH_KEY    = "$env:USERPROFILE\.ssh\google_compute_engine"
$SERVER     = "lszok@34.146.249.102"

# Fájl → szerver célútvonal (src\ relatív a BW_ROOT-hoz)
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
    "src\core\fuzzy_extractor.js" = "/var/www/biowallet/core/fuzzy_extractor.js"
    "src\core\rpc.js"        = "/var/www/biowallet/core/rpc.js"
    "dapp-guide.html"        = "/var/www/biowallet/dapp-guide.html"
    "dapp-guide.js"          = "/var/www/biowallet/dapp-guide.js"
    "checksums.txt"          = "/var/www/biowallet/checksums.txt"
    "recovery_tool.html"     = "/var/www/biowallet/recovery_tool.html"
}

# PRECACHE-ben lévő fájlok (sw.js változásakor ezeket figyeli a preflight)
$PRECACHE_FILES = @(
    "src\app\app.js", "src\app\vault_worker.js", "src\app\index.html",
    "src\core\vault.js", "src\core\wallet.js", "src\core\wc2.js",
    "src\core\i18n.js", "src\core\swap.js", "src\core\fuzzy_extractor.js", "src\core\rpc.js",
    "src\core\bio_capture.js", "src\core\causal_chain.js", "src\core\recovery_formula.js",
    "dapp-guide.html", "dapp-guide.js", "recovery_tool.html"
)

# ── Segédfüggvények ───────────────────────────────────────────────────────────
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

    # 3. PRECACHE fájlok változtak-e a SW bump óta?
    $swBumpHash = ($swBumpCommit -split ' ')[0]
    $changedAfterBump = @()
    foreach ($f in $PRECACHE_FILES) {
        $gitPath = "BioWallet/$($f -replace '\\','/')"
        $changed = git -C $REPO_ROOT diff --name-only "${swBumpHash}..HEAD" -- $gitPath
        if ($changed) { $changedAfterBump += $f }
    }

    if ($changedAfterBump.Count -gt 0) {
        Write-Fail "PRECACHE fájlok változtak a v$swVersion bump ($swBumpHash) UTÁN:"
        $changedAfterBump | ForEach-Object { Write-Fail "    $_" }
        Write-Fail "-> Bumold a SW verziót, majd futtasd újra a deploy-t!"
        Write-Fail "  (Kihagyáshoz: -SkipPreflight, de csak ha tudod mit csinálsz)"
        exit 1
    } else {
        Write-Ok "Nincs PRECACHE változás a SW bump után - rendben"
    }

    # 4. Munkafa tiszta?
    $dirty = git -C $REPO_ROOT status --short -- BioWallet/
    if ($dirty) {
        Write-Warn "Uncommitted változások a BioWallet könyvtárban:"
        $dirty | ForEach-Object { Write-Warn "    $_" }
        Write-Warn "Folytatod? (Enter = igen, Ctrl+C = megszakít)"
        Read-Host | Out-Null
    } else {
        Write-Ok "Working tree tiszta"
    }

    # 5. SSH kulcs megléte
    if (-not (Test-Path $SSH_KEY)) {
        Write-Fail "SSH kulcs nem található: $SSH_KEY"
        exit 1
    }
    Write-Ok "SSH kulcs: $SSH_KEY"
}

# ── SCP Deploy ────────────────────────────────────────────────────────────────
Write-Step "SCP DEPLOY → $SERVER"

$errors = 0
foreach ($entry in $DEPLOY_MAP.GetEnumerator()) {
    $srcFull = Join-Path $BW_ROOT $entry.Key
    $dst     = $entry.Value
    if (-not (Test-Path $srcFull)) {
        Write-Warn "Kihagyva (nem létezik): $($entry.Key)"
        continue
    }
    Write-Host "  $($entry.Key) → $dst" -NoNewline
    scp -i $SSH_KEY -o StrictHostKeyChecking=no -q "$srcFull" "${SERVER}:${dst}"
    if ($LASTEXITCODE -ne 0) {
        Write-Fail " HIBA"
        $errors++
    } else {
        Write-Ok " OK"
    }
}

if ($errors -gt 0) {
    Write-Fail "$errors fajl SCP-je sikertelen - ellenorizd a kapcsolatot!"
    exit 1
}

# ── GitHub subtree push ───────────────────────────────────────────────────────
if (-not $SkipGitPush) {
    Write-Step "GITHUB SUBTREE PUSH"

    Write-Host "  subtree split folyamatban..." -NoNewline
    $splitOut = git -C $REPO_ROOT subtree split --prefix=BioWallet -b biowallet-deploy 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Fail " HIBA`n$splitOut"
        exit 1
    }
    Write-Ok " kész"

    Write-Host "  push origin biowallet-deploy:main --force..." -NoNewline
    git -C $REPO_ROOT push origin biowallet-deploy:main --force 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail " HIBA"
        git -C $REPO_ROOT branch -D biowallet-deploy 2>$null
        exit 1
    }
    Write-Ok " kész"

    git -C $REPO_ROOT branch -D biowallet-deploy | Out-Null
    Write-Ok "Temp branch törölve"
} else {
    Write-Warn "GitHub push kihagyva (-SkipGitPush)"
}

Write-Host "`nDeploy kesz!" -ForegroundColor Green
