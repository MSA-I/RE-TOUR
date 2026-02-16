# RE-TOUR Local Development Stop Script (PowerShell)
# Stops all development services
# Usage: npm run dev:stop:windows or .\scripts\dev-stop.ps1

# Project root directory
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $PROJECT_ROOT

Write-Host ""
Write-Host "╔═══════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║  RE-TOUR Local Development Shutdown      ║" -ForegroundColor Blue
Write-Host "╚═══════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

$servicesStopped = 0

# ============================================
# STOP VITE DEV SERVER
# ============================================
Write-Host "🛑 Stopping Vite dev server..." -ForegroundColor Yellow

# Find and kill Vite processes on ports 8080 and 8081
$vitePorts = @(8080, 8081)
foreach ($port in $vitePorts) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        $process = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            Write-Host "  ✓ Vite dev server stopped (port $port)" -ForegroundColor Green
            $servicesStopped++
        }
    }
}

# Also try to kill by process name
$viteProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -like "*vite*" -or $_.CommandLine -like "*vite*"
}
foreach ($proc in $viteProcesses) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}

if ($servicesStopped -eq 0) {
    Write-Host "  ℹ️  Vite dev server not running" -ForegroundColor Yellow
}

# ============================================
# STOP EDGE FUNCTIONS
# ============================================
Write-Host "🛑 Stopping Edge Functions..." -ForegroundColor Yellow

if (Test-Path "logs\functions.pid") {
    $functionsPid = Get-Content "logs\functions.pid" -ErrorAction SilentlyContinue

    if ($functionsPid) {
        $process = Get-Process -Id $functionsPid -ErrorAction SilentlyContinue
        if ($process) {
            Stop-Process -Id $functionsPid -Force -ErrorAction SilentlyContinue
            Write-Host "  ✓ Edge Functions stopped (PID: $functionsPid)" -ForegroundColor Green
            $servicesStopped++
        } else {
            Write-Host "  ℹ️  Edge Functions process not running" -ForegroundColor Yellow
        }
    }

    Remove-Item "logs\functions.pid" -Force -ErrorAction SilentlyContinue
} else {
    # Try to find and kill by process name/command line
    $functionsProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*functions serve*"
    }

    if ($functionsProcesses) {
        foreach ($proc in $functionsProcesses) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "  ✓ Edge Functions stopped" -ForegroundColor Green
        $servicesStopped++
    } else {
        Write-Host "  ℹ️  Edge Functions not running" -ForegroundColor Yellow
    }
}

# ============================================
# STOP SUPABASE
# ============================================
Write-Host "🛑 Stopping Supabase..." -ForegroundColor Yellow

if (Get-Command "supabase" -ErrorAction SilentlyContinue) {
    try {
        supabase stop 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "  ✓ Supabase stopped" -ForegroundColor Green
            $servicesStopped++
        } else {
            Write-Host "  ℹ️  Supabase was not running" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ℹ️  Supabase was not running" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⚠️  Supabase CLI not found" -ForegroundColor Red
}

# ============================================
# CLEAN UP LOG FILES
# ============================================
Write-Host "🧹 Cleaning up..." -ForegroundColor Yellow

# Remove PID files
Remove-Item "logs\functions.pid" -Force -ErrorAction SilentlyContinue

# Optionally archive old log files (keep the most recent)
if (Test-Path "logs\functions.log") {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $archivePath = "logs\functions_$timestamp.log"
    Move-Item "logs\functions.log" $archivePath -Force -ErrorAction SilentlyContinue
    Write-Host "  ✓ Logs archived" -ForegroundColor Green
}

Write-Host ""

# ============================================
# FINAL STATUS
# ============================================
if ($servicesStopped -gt 0) {
    Write-Host "✅ Successfully stopped $servicesStopped service(s)" -ForegroundColor Green
} else {
    Write-Host "ℹ️  No services were running" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "All services stopped. Run 'npm run dev:start:windows' to start again." -ForegroundColor Blue
Write-Host ""
