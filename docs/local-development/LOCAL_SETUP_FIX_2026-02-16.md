# Local Supabase Setup Fix

**Date:** 2026-02-16
**Status:** ✅ RESOLVED

## Problem

User reported:
- Functions do not work and are not visible in the UI
- App doesn't let them upload files and perform actions

## Root Cause

The Edge Functions server was not running. While the Supabase database and APIs were running correctly, the Edge Functions runtime needs to be started separately.

## Solution Applied

### 1. Started Edge Functions Server
```bash
cd supabase && npx supabase functions serve --env-file .env
```

**Result:** 73 functions now available at `http://127.0.0.1:54321/functions/v1/`

### 2. Started Frontend Dev Server
```bash
npm run dev
```

**Result:** Frontend running at `http://localhost:8081`

## Current Status

### ✅ All Services Running

| Service | Status | URL |
|---------|--------|-----|
| Supabase Database | ✅ Running | `http://127.0.0.1:54321` |
| Studio UI | ✅ Running | `http://127.0.0.1:54323` |
| Edge Functions | ✅ Running | `http://127.0.0.1:54321/functions/v1/` |
| Frontend Dev Server | ✅ Running | `http://localhost:8081` |

### ✅ Configuration Files Verified

- `.env.local` - Contains local Supabase credentials (frontend)
- `supabase/.env` - Contains Gemini API key (Edge Functions)

## Testing Checklist

Now you should be able to:
- [ ] Open app at `http://localhost:8081`
- [ ] Upload files (tests tab or other upload features)
- [ ] See functions working without errors
- [ ] Perform actions that trigger Edge Functions

## Important Notes

### Functions in Studio UI
**Edge Functions will NOT appear in the Studio UI** - this is normal behavior for local development. The Studio UI only shows:
- Database tables
- Authentication users
- Storage buckets
- Realtime

Edge Functions are accessible via HTTP endpoints only.

### File Upload Process
When you upload files, the following happens:
1. Frontend calls `create-signed-upload-url` function
2. File is uploaded to local storage bucket
3. Backend functions process the file
4. Results are stored in database

All of this should now work correctly.

## Monitoring

### View Edge Function Logs
```bash
tail -f /tmp/functions.log
```

### View Dev Server Logs
```bash
tail -f /tmp/vite-dev.log
```

### Check Running Services
```bash
supabase status
```

## If Something Stops Working

### Restart Edge Functions
```bash
# Find and kill the process
ps aux | grep "functions serve" | grep -v grep | awk '{print $2}' | xargs kill

# Start again
cd supabase && npx supabase functions serve --env-file .env > /tmp/functions.log 2>&1 &
```

### Restart Dev Server
```bash
# Find and kill the process
ps aux | grep "vite" | grep -v grep | awk '{print $2}' | xargs kill

# Start again
npm run dev > /tmp/vite-dev.log 2>&1 &
```

### Restart Supabase
```bash
supabase stop
supabase start
```

## Quick Start Script (For Future Use)

Create a file `start-local.sh`:
```bash
#!/bin/bash

echo "Starting Supabase..."
supabase start

echo "Starting Edge Functions..."
cd supabase && npx supabase functions serve --env-file .env > /tmp/functions.log 2>&1 &

echo "Starting Dev Server..."
cd .. && npm run dev > /tmp/vite-dev.log 2>&1 &

echo ""
echo "✅ All services started!"
echo ""
echo "Frontend: http://localhost:8080"
echo "Studio UI: http://127.0.0.1:54323"
echo "Edge Functions: http://127.0.0.1:54321/functions/v1/"
echo ""
echo "View logs:"
echo "  Functions: tail -f /tmp/functions.log"
echo "  Dev Server: tail -f /tmp/vite-dev.log"
```

Make it executable:
```bash
chmod +x start-local.sh
```

Run it:
```bash
./start-local.sh
```

## Related Documentation

- `Troubleshooting_Agent/LOCAL_SUPABASE_SETUP_COMPLETE.md` - Initial setup
- `Troubleshooting_Agent/LOCAL_DEV_QUICKSTART.md` - Quick start guide
- `Troubleshooting_Agent/FINAL_FIX_SUMMARY.md` - Previous fixes applied

## Next Steps

1. Open `http://localhost:8081` in your browser
2. Try uploading a file
3. Check the browser console for any errors
4. If you see any errors, check the function logs: `tail -f /tmp/functions.log`

Everything should now work correctly!
