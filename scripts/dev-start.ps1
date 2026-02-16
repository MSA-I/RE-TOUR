# RE-TOUR Local Development Startup Script (PowerShell)
# Starts Supabase, Edge Functions, and Frontend Dev Server
# Usage: npm run dev:start:windows or .\scripts\dev-start.ps1

# Enable strict mode
$ErrorActionPreference = "Stop"

# Project root directory
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $PROJECT_ROOT

# Create logs directory
New-Item -ItemType Directory -Force -Path "logs" | Out-Null

# Cleanup function
function Cleanup {
    Write-Host ""
    Write-Host "🛑 Shutting down services..." -ForegroundColor Yellow

    # Kill Edge Functions process
    if (Test-Path "logs\functions.pid") {
        $functionsPid = Get-Content "logs\functions.pid"
        $process = Get-Process -Id $functionsPid -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "  Stopping Edge Functions (PID: $functionsPid)..." -ForegroundColor Yellow
            Stop-Process -Id $functionsPid -Force -ErrorAction SilentlyContinue
        }
        Remove-Item "logs\functions.pid" -Force -ErrorAction SilentlyContinue
    }

    Write-Host "✅ Cleanup complete" -ForegroundColor Green
}

# Register cleanup on exit
trap { Cleanup; break }

# Function to check if a port is in use
function Test-Port {
    param (
        [int]$Port,
        [string]$Service
    )

    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connection) {
        Write-Host "❌ Port $Port is already in use (needed for $Service)" -ForegroundColor Red
        Write-Host "   Run 'npm run dev:stop:windows' to stop services" -ForegroundColor Yellow
        return $false
    }

    return $true
}

# Function to check if command exists
function Test-Command {
    param ([string]$Command)
    return [bool](Get-Command $Command -ErrorAction SilentlyContinue)
}

# Banner
Write-Host ""
Write-Host "╔═══════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║  RE-TOUR Local Development Startup       ║" -ForegroundColor Blue
Write-Host "╚═══════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
Write-Host "🔍 Running pre-flight checks..." -ForegroundColor Green
Write-Host ""

# Check Docker
if (-not (Test-Command "docker")) {
    Write-Host "❌ Docker not found. Please install Docker Desktop." -ForegroundColor Red
    exit 1
}

try {
    docker info | Out-Null
    Write-Host "  ✓ Docker is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}

# Check Supabase CLI
if (-not (Test-Command "supabase")) {
    Write-Host "❌ Supabase CLI not found. Install: npm install -g supabase" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ Supabase CLI installed" -ForegroundColor Green

# Check Node/npm
if (-not (Test-Command "npm")) {
    Write-Host "❌ npm not found. Please install Node.js" -ForegroundColor Red
    exit 1
}
Write-Host "  ✓ npm installed" -ForegroundColor Green

# Check environment files
if (-not (Test-Path ".env.local")) {
    Write-Host "❌ .env.local not found" -ForegroundColor Red
    Write-Host "   This file should contain your local Supabase credentials" -ForegroundColor Yellow
    exit 1
}
Write-Host "  ✓ .env.local exists" -ForegroundColor Green

if (-not (Test-Path "supabase\.env")) {
    Write-Host "❌ supabase\.env not found" -ForegroundColor Red
    Write-Host "   This file should contain your API_NANOBANANA key" -ForegroundColor Yellow
    exit 1
}
Write-Host "  ✓ supabase\.env exists" -ForegroundColor Green

# Check ports availability
Write-Host ""
Write-Host "🔌 Checking port availability..." -ForegroundColor Green
if (-not (Test-Port -Port 54321 -Service "Supabase API")) { exit 1 }
if (-not (Test-Port -Port 54322 -Service "Supabase Database")) { exit 1 }
if (-not (Test-Port -Port 54323 -Service "Supabase Studio")) { exit 1 }
if (-not (Test-Port -Port 8080 -Service "Vite Dev Server")) {
    if (-not (Test-Port -Port 8081 -Service "Vite Dev Server (fallback)")) { exit 1 }
}
Write-Host "  ✓ All required ports are available" -ForegroundColor Green

Write-Host ""
Write-Host "✅ All pre-flight checks passed!" -ForegroundColor Green
Write-Host ""

# ============================================
# START SUPABASE
# ============================================
Write-Host "🚀 Starting Supabase (Docker containers)..." -ForegroundColor Green
Write-Host "   This may take 30-60 seconds on first run" -ForegroundColor Yellow
Write-Host ""

try {
    supabase start
    if ($LASTEXITCODE -ne 0) {
        throw "Supabase start failed"
    }
} catch {
    Write-Host "❌ Failed to start Supabase" -ForegroundColor Red
    exit 1
}

# Wait for Supabase to be ready
Write-Host ""
Write-Host "⏳ Waiting for Supabase to be ready..." -ForegroundColor Green
$maxRetries = 30
$retryCount = 0

while ($retryCount -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:54321/rest/v1/" -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 401) {
            Write-Host "  ✓ Supabase is ready!" -ForegroundColor Green
            break
        }
    } catch {
        # Continue waiting
    }

    $retryCount++
    if ($retryCount -eq $maxRetries) {
        Write-Host "❌ Supabase failed to become ready after $maxRetries seconds" -ForegroundColor Red
        exit 1
    }

    Start-Sleep -Seconds 1
    Write-Host "  Waiting... ($retryCount/$maxRetries)" -ForegroundColor Yellow -NoNewline
    Write-Host "`r" -NoNewline
}

Write-Host ""

# ============================================
# START EDGE FUNCTIONS
# ============================================
Write-Host "⚡ Starting Edge Functions (73+ functions)..." -ForegroundColor Green
Write-Host ""

# Start Edge Functions in background
$functionsJob = Start-Process -FilePath "npx" `
    -ArgumentList "supabase", "functions", "serve", "--env-file", ".env" `
    -WorkingDirectory "supabase" `
    -RedirectStandardOutput "..\logs\functions.log" `
    -RedirectStandardError "..\logs\functions.log" `
    -PassThru `
    -WindowStyle Hidden

$functionsPid = $functionsJob.Id
$functionsPid | Out-File -FilePath "logs\functions.pid" -Encoding ASCII

# Wait a moment for functions to start
Start-Sleep -Seconds 2

# Verify functions process is running
if (-not (Get-Process -Id $functionsPid -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Edge Functions failed to start" -ForegroundColor Red
    Write-Host "   Check logs: Get-Content logs\functions.log -Tail 20" -ForegroundColor Yellow
    exit 1
}

Write-Host "  ✓ Edge Functions started (PID: $functionsPid)" -ForegroundColor Green
Write-Host ""

# ============================================
# DISPLAY STATUS
# ============================================
Write-Host ""
Write-Host "╔═══════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║  ✅ Services Started Successfully!        ║" -ForegroundColor Blue
Write-Host "╚═══════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""
Write-Host "📡 Access URLs:" -ForegroundColor Green
Write-Host "  Frontend:       http://localhost:8080" -ForegroundColor White
Write-Host "  Studio UI:      http://127.0.0.1:54323" -ForegroundColor White
Write-Host "  Edge Functions: http://127.0.0.1:54321/functions/v1/" -ForegroundColor White
Write-Host "  REST API:       http://127.0.0.1:54321/rest/v1" -ForegroundColor White
Write-Host ""
Write-Host "📋 Useful Commands:" -ForegroundColor Green
Write-Host "  Function logs:   Get-Content logs\functions.log -Tail 20 -Wait" -ForegroundColor White
Write-Host "  Supabase status: npm run dev:status" -ForegroundColor White
Write-Host "  Stop services:   npm run dev:stop:windows (or Ctrl+C)" -ForegroundColor White
Write-Host ""
Write-Host "ℹ️  Press Ctrl+C to stop all services" -ForegroundColor Yellow
Write-Host ""
Write-Host ""

# ============================================
# START VITE (FOREGROUND)
# ============================================
Write-Host "🎨 Starting Vite dev server..." -ForegroundColor Green
Write-Host ""

# Run Vite in foreground - when it exits, cleanup will run automatically
try {
    npm run dev
} finally {
    Cleanup
}
