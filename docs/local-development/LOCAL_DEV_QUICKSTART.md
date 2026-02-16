# Local Development Quick Start Guide

**Date:** 2026-02-16
**Status:** ✅ CONFIGURED - Automated Startup Available!

## Quick Start (Automated - Recommended)

### Start All Services with One Command

**For Mac/Linux/Git Bash:**
```bash
npm run dev:start
```

**For Windows PowerShell:**
```bash
npm run dev:start:windows
```

This single command will:
- ✅ Run pre-flight checks (Docker, Supabase CLI, env files, ports)
- ✅ Start Supabase (Database + APIs)
- ✅ Start Edge Functions (73+ functions)
- ✅ Start Frontend Dev Server
- ✅ Display all access URLs
- ✅ Auto-cleanup on Ctrl+C

### Stop All Services

**For Mac/Linux/Git Bash:**
```bash
npm run dev:stop
```

**For Windows PowerShell:**
```bash
npm run dev:stop:windows
```

Or simply press **Ctrl+C** in the terminal running dev:start.

---

## Manual Start (Alternative)

If you prefer to start services manually:

### 1. Start Supabase (Database + APIs)
```bash
supabase start
```

### 2. Start Edge Functions (with Gemini API)
```bash
cd supabase && npx supabase functions serve --env-file .env > ../logs/functions.log 2>&1 &
```

### 3. Start Frontend Dev Server
```bash
npm run dev
```

## Monitoring

**View function logs:**
```bash
npm run dev:logs:functions
# Or directly: tail -f logs/functions.log
```

**Check Supabase status:**
```bash
npm run dev:status
# Or directly: supabase status
```

**Access URLs:**
- Frontend: http://localhost:8080
- Studio UI: http://127.0.0.1:54323
- Edge Functions: http://127.0.0.1:54321/functions/v1/
- REST API: http://127.0.0.1:54321/rest/v1

## Environment Configuration

### Frontend (.env.local)
```env
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=eyJhbGc...I0
```

### Edge Functions (supabase/.env)
```env
API_NANOBANANA=AIzaSyAxpIPia3BAERNVinpDm2G_ia8Sjxzpnmk
```

## Key Endpoints

- **Project URL:** http://127.0.0.1:54321
- **REST API:** http://127.0.0.1:54321/rest/v1
- **Edge Functions:** http://127.0.0.1:54321/functions/v1/
- **Studio UI:** http://127.0.0.1:54323
- **Database:** postgresql://postgres:postgres@127.0.0.1:54322/postgres

## Troubleshooting

### Services not starting?
The automated startup script runs pre-flight checks and will show clear error messages if:
- Docker is not running → Start Docker Desktop
- Ports are in use → Run `npm run dev:stop` first
- Environment files missing → Check `.env.local` and `supabase/.env` exist

### Functions not working?
1. Check if functions server is running: View logs with `npm run dev:logs:functions`
2. Restart: Stop services (`npm run dev:stop`) and start again (`npm run dev:start`)

### Database connection issues?
1. Check Supabase status: `npm run dev:status`
2. Restart: `npm run dev:stop` then `npm run dev:start`

### Port conflicts?
If you see "Port already in use" errors:
1. Run `npm run dev:stop` to clean up any orphaned processes
2. Check what's using ports: `lsof -i :54321` (Mac/Linux) or `netstat -ano | findstr "54321"` (Windows)
3. Kill the conflicting process or change your setup

### API key errors?
Verify `supabase/.env` exists and contains:
```env
API_NANOBANANA=AIzaSyAxpIPia3BAERNVinpDm2G_ia8Sjxzpnmk
```

## Important Notes

- ✅ Local database is isolated from production
- ✅ All AI operations use Gemini (API_NANOBANANA)
- ✅ No OpenAI API needed
- ✅ Functions don't appear in Studio UI (this is normal for local dev)
- ✅ Studio shows database tables and auth, but not Edge Functions
- ✅ Edge Functions are accessible via HTTP endpoints from your app

## Available npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:start` | Start all services (Mac/Linux/Git Bash) |
| `npm run dev:start:windows` | Start all services (Windows PowerShell) |
| `npm run dev:stop` | Stop all services (Mac/Linux/Git Bash) |
| `npm run dev:stop:windows` | Stop all services (Windows PowerShell) |
| `npm run dev:logs:functions` | View Edge Functions logs |
| `npm run dev:status` | Check Supabase status |
| `npm run dev` | Start Vite only (if services already running) |

## Files Created/Modified

- `.env.local` - Frontend Supabase credentials
- `supabase/.env` - Edge Functions environment (Gemini API key)
- `supabase/functions/_shared/cors.ts` - CORS configuration
- Migration fixes in `supabase/migrations/`
- **New:** `scripts/dev-start.sh` - Automated startup (Bash)
- **New:** `scripts/dev-start.ps1` - Automated startup (PowerShell)
- **New:** `scripts/dev-stop.sh` - Automated shutdown (Bash)
- **New:** `scripts/dev-stop.ps1` - Automated shutdown (PowerShell)
- **New:** `logs/` - Function logs directory
