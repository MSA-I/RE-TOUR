#!/bin/bash

# RE-TOUR Local Development Stop Script
# Stops all development services
# Usage: npm run dev:stop or ./scripts/dev-stop.sh

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  RE-TOUR Local Development Shutdown      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

SERVICES_STOPPED=0

# ============================================
# STOP VITE DEV SERVER
# ============================================
echo -e "${YELLOW}🛑 Stopping Vite dev server...${NC}"

# Find and kill Vite processes
if command -v lsof &> /dev/null; then
  VITE_PIDS=$(lsof -ti:8080,8081 2>/dev/null || true)
  if [ -n "$VITE_PIDS" ]; then
    echo "$VITE_PIDS" | xargs kill 2>/dev/null || true
    sleep 1
    # Force kill if still running
    echo "$VITE_PIDS" | xargs kill -9 2>/dev/null || true
    echo -e "${GREEN}  ✓ Vite dev server stopped${NC}"
    SERVICES_STOPPED=$((SERVICES_STOPPED + 1))
  else
    echo -e "${YELLOW}  ℹ️  Vite dev server not running${NC}"
  fi
elif command -v netstat &> /dev/null; then
  # Windows fallback using netstat
  for port in 8080 8081; do
    PID=$(netstat -ano | grep ":$port.*LISTENING" | awk '{print $5}' | head -n 1)
    if [ -n "$PID" ]; then
      taskkill //PID $PID //F 2>/dev/null || true
      echo -e "${GREEN}  ✓ Vite dev server stopped (port $port)${NC}"
      SERVICES_STOPPED=$((SERVICES_STOPPED + 1))
    fi
  done
else
  # Fallback: try to kill by process name
  pkill -f "vite" 2>/dev/null || true
  echo -e "${YELLOW}  ℹ️  Attempted to stop Vite${NC}"
fi

# ============================================
# STOP EDGE FUNCTIONS
# ============================================
echo -e "${YELLOW}🛑 Stopping Edge Functions...${NC}"

if [ -f logs/functions.pid ]; then
  FUNCTIONS_PID=$(cat logs/functions.pid)

  if ps -p $FUNCTIONS_PID > /dev/null 2>&1; then
    kill $FUNCTIONS_PID 2>/dev/null || true
    sleep 1

    # Force kill if still running
    if ps -p $FUNCTIONS_PID > /dev/null 2>&1; then
      kill -9 $FUNCTIONS_PID 2>/dev/null || true
    fi

    echo -e "${GREEN}  ✓ Edge Functions stopped (PID: $FUNCTIONS_PID)${NC}"
    SERVICES_STOPPED=$((SERVICES_STOPPED + 1))
  else
    echo -e "${YELLOW}  ℹ️  Edge Functions process not running${NC}"
  fi

  rm logs/functions.pid 2>/dev/null || true
else
  # Try to find and kill by process name
  if pgrep -f "functions serve" > /dev/null 2>&1; then
    pkill -f "functions serve" 2>/dev/null || true
    sleep 1
    pkill -9 -f "functions serve" 2>/dev/null || true
    echo -e "${GREEN}  ✓ Edge Functions stopped${NC}"
    SERVICES_STOPPED=$((SERVICES_STOPPED + 1))
  else
    echo -e "${YELLOW}  ℹ️  Edge Functions not running${NC}"
  fi
fi

# ============================================
# STOP SUPABASE
# ============================================
echo -e "${YELLOW}🛑 Stopping Supabase...${NC}"

if command -v supabase &> /dev/null; then
  if supabase stop 2>/dev/null; then
    echo -e "${GREEN}  ✓ Supabase stopped${NC}"
    SERVICES_STOPPED=$((SERVICES_STOPPED + 1))
  else
    echo -e "${YELLOW}  ℹ️  Supabase was not running${NC}"
  fi
else
  echo -e "${RED}  ⚠️  Supabase CLI not found${NC}"
fi

# ============================================
# CLEAN UP LOG FILES
# ============================================
echo -e "${YELLOW}🧹 Cleaning up...${NC}"

# Remove PID files
rm -f logs/functions.pid 2>/dev/null || true

# Optionally clean up old log files (keep the most recent)
if [ -f logs/functions.log ]; then
  # Archive old log with timestamp
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  mv logs/functions.log "logs/functions_${TIMESTAMP}.log" 2>/dev/null || true
  echo -e "${GREEN}  ✓ Logs archived${NC}"
fi

echo ""

# ============================================
# FINAL STATUS
# ============================================
if [ $SERVICES_STOPPED -gt 0 ]; then
  echo -e "${GREEN}✅ Successfully stopped $SERVICES_STOPPED service(s)${NC}"
else
  echo -e "${YELLOW}ℹ️  No services were running${NC}"
fi

echo ""
echo -e "${BLUE}All services stopped. Run 'npm run dev:start' to start again.${NC}"
echo ""
