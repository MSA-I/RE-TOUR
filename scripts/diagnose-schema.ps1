# RE-TOUR Database Schema Diagnostic Script
# Purpose: Check if required database tables/views exist

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "RE-TOUR Database Schema Diagnostic" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Load environment variables
if (Test-Path ".env") {
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    Write-Host "✓ Loaded .env file" -ForegroundColor Green
}
else {
    Write-Host "⚠ .env file not found" -ForegroundColor Yellow
}

$SUPABASE_URL = $env:VITE_SUPABASE_URL
$SUPABASE_ANON_KEY = $env:VITE_SUPABASE_ANON_KEY
$PROJECT_ID = $env:VITE_SUPABASE_PROJECT_ID

if (-not $SUPABASE_URL -or -not $SUPABASE_ANON_KEY) {
    Write-Host "✗ Missing environment variables" -ForegroundColor Red
    exit 1
}

Write-Host "Project: $PROJECT_ID" -ForegroundColor Cyan
Write-Host ""

# Test database objects
Write-Host "Checking database objects..." -ForegroundColor Yellow
Write-Host ""

$headers = @{
    "apikey"        = $SUPABASE_ANON_KEY
    "Authorization" = "Bearer $SUPABASE_ANON_KEY"
}

$objects = @(
    "floorplan_pipelines",
    "floorplan_pipeline_spaces",
    "camera_intents",
    "camera_intents_with_spaces"
)

$missingCount = 0

foreach ($obj in $objects) {
    Write-Host "  $obj..." -NoNewline
    try {
        $url = "$SUPABASE_URL/rest/v1/$obj?limit=0"
        $response = Invoke-WebRequest -Uri $url -Method Get -Headers $headers -ErrorAction Stop
        Write-Host " ✓" -ForegroundColor Green
    }
    catch {
        $err = $_.Exception.Message
        if ($err -match "PGRST116" -or $err -match "not find") {
            Write-Host " ✗ MISSING" -ForegroundColor Red
            $missingCount++
        }
        elseif ($err -match "PGRST301") {
            Write-Host " ⚠ No permission" -ForegroundColor Yellow
        }
        else {
            Write-Host " ? Error" -ForegroundColor Red
            $missingCount++
        }
    }
}

Write-Host ""

if ($missingCount -eq 0) {
    Write-Host "✓ All objects exist!" -ForegroundColor Green
}
else {
    Write-Host "✗ Found $missingCount missing object(s)" -ForegroundColor Red
    Write-Host ""
    Write-Host "FIX: Apply database migrations" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Run these commands:" -ForegroundColor Cyan
    Write-Host "  supabase link --project-ref $PROJECT_ID" -ForegroundColor White
    Write-Host "  supabase db push" -ForegroundColor White
    Write-Host ""
}

Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
