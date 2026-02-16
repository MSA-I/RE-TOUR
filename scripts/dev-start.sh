#!/bin/bash

# RE-TOUR Local Development Startup Script
# Starts Supabase, Edge Functions, and Frontend Dev Server
# Usage: npm run dev:start or ./scripts/dev-start.sh

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Create logs directory
mkdir -p logs

# Cleanup function (called on EXIT, INT, TERM)
cleanup() {
  echo ""
  echo -e "${YELLOW}🛑 Shutting down services...${NC}"

  # Kill Edge Functions process
  if [ -f logs/functions.pid ]; then
    FUNCTIONS_PID=$(cat logs/functions.pid)
    if ps -p $FUNCTIONS_PID > /dev/null 2>&1; then
      echo -e "${YELLOW}  Stopping Edge Functions (PID: $FUNCTIONS_PID)...${NC}"
      kill $FUNCTIONS_PID 2>/dev/null || true
      sleep 1
      # Force kill if still running
      if ps -p $FUNCTIONS_PID > /dev/null 2>&1; then
        kill -9 $FUNCTIONS_PID 2>/dev/null || true
      fi
    fi
    rm logs/functions.pid 2>/dev/null || true
  fi

  echo -e "${GREEN}✅ Cleanup complete${NC}"
}

# Register cleanup function
trap cleanup EXIT INT TERM

# Function to check if a port is in use
check_port() {
  local port=$1
  local service=$2

  # Use different commands based on OS
  if command -v lsof &> /dev/null; then
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo -e "${RED}❌ Port $port is already in use (needed for $service)${NC}"
      echo -e "${YELLOW}   Run 'npm run dev:stop' or check: lsof -i :$port${NC}"
      return 1
    fi
  elif command -v netstat &> /dev/null; then
    if netstat -ano | grep -q ":$port.*LISTENING"; then
      echo -e "${RED}❌ Port $port is already in use (needed for $service)${NC}"
      echo -e "${YELLOW}   Run 'npm run dev:stop' to stop services${NC}"
      return 1
    fi
  fi

  return 0
}

# Function to check if command exists
command_exists() {
  command -v "$1" &> /dev/null
}

# Banner
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  RE-TOUR Local Development Startup       ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
echo -e "${GREEN}🔍 Running pre-flight checks...${NC}"
echo ""

# Check Docker
if ! command_exists docker; then
  echo -e "${RED}❌ Docker not found. Please install Docker Desktop.${NC}"
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}❌ Docker is not running. Please start Docker Desktop.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Docker is running${NC}"

# Check Supabase CLI
if ! command_exists supabase; then
  echo -e "${RED}❌ Supabase CLI not found. Install: npm install -g supabase${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Supabase CLI installed${NC}"

# Check Node/npm
if ! command_exists npm; then
  echo -e "${RED}❌ npm not found. Please install Node.js${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ npm installed${NC}"

# Check environment files
if [ ! -f ".env.local" ]; then
  echo -e "${RED}❌ .env.local not found${NC}"
  echo -e "${YELLOW}   This file should contain your local Supabase credentials${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ .env.local exists${NC}"

if [ ! -f "supabase/.env" ]; then
  echo -e "${RED}❌ supabase/.env not found${NC}"
  echo -e "${YELLOW}   This file should contain your API_NANOBANANA key${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ supabase/.env exists${NC}"

# Check ports availability
echo ""
echo -e "${GREEN}🔌 Checking port availability...${NC}"
check_port 54321 "Supabase API" || exit 1
check_port 54322 "Supabase Database" || exit 1
check_port 54323 "Supabase Studio" || exit 1
check_port 8080 "Vite Dev Server" || check_port 8081 "Vite Dev Server (fallback)" || exit 1
echo -e "${GREEN}  ✓ All required ports are available${NC}"

echo ""
echo -e "${GREEN}✅ All pre-flight checks passed!${NC}"
echo ""

# ============================================
# START SUPABASE
# ============================================
echo -e "${GREEN}🚀 Starting Supabase (Docker containers)...${NC}"
echo -e "${YELLOW}   This may take 30-60 seconds on first run${NC}"
echo ""

if ! supabase start; then
  echo -e "${RED}❌ Failed to start Supabase${NC}"
  exit 1
fi

# Wait for Supabase to be ready
echo ""
echo -e "${GREEN}⏳ Waiting for Supabase to be ready...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s http://127.0.0.1:54321/rest/v1/ > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Supabase is ready!${NC}"
    break
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))
  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ Supabase failed to become ready after ${MAX_RETRIES} seconds${NC}"
    exit 1
  fi

  sleep 1
  echo -ne "${YELLOW}  Waiting... ($RETRY_COUNT/$MAX_RETRIES)\r${NC}"
done

echo ""

# ============================================
# START EDGE FUNCTIONS
# ============================================
echo -e "${GREEN}⚡ Starting Edge Functions (73+ functions)...${NC}"
echo ""

cd supabase
npx supabase functions serve --env-file .env > ../logs/functions.log 2>&1 &
FUNCTIONS_PID=$!
echo $FUNCTIONS_PID > ../logs/functions.pid
cd ..

# Wait a moment for functions to start
sleep 2

# Verify functions process is running
if ! ps -p $FUNCTIONS_PID > /dev/null 2>&1; then
  echo -e "${RED}❌ Edge Functions failed to start${NC}"
  echo -e "${YELLOW}   Check logs: tail -f logs/functions.log${NC}"
  exit 1
fi

echo -e "${GREEN}  ✓ Edge Functions started (PID: $FUNCTIONS_PID)${NC}"
echo ""

# ============================================
# DISPLAY STATUS
# ============================================
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  ✅ Services Started Successfully!        ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}📡 Access URLs:${NC}"
echo -e "  ${BLUE}Frontend:${NC}       http://localhost:8080"
echo -e "  ${BLUE}Studio UI:${NC}      http://127.0.0.1:54323"
echo -e "  ${BLUE}Edge Functions:${NC} http://127.0.0.1:54321/functions/v1/"
echo -e "  ${BLUE}REST API:${NC}       http://127.0.0.1:54321/rest/v1"
echo ""
echo -e "${GREEN}📋 Useful Commands:${NC}"
echo -e "  ${BLUE}Function logs:${NC}  npm run dev:logs:functions"
echo -e "  ${BLUE}Supabase status:${NC} npm run dev:status"
echo -e "  ${BLUE}Stop services:${NC}  npm run dev:stop (or Ctrl+C)"
echo ""
echo -e "${YELLOW}ℹ️  Press Ctrl+C to stop all services${NC}"
echo ""
echo ""

# ============================================
# START VITE (FOREGROUND)
# ============================================
echo -e "${GREEN}🎨 Starting Vite dev server...${NC}"
echo ""

# Run Vite in foreground - when it exits, cleanup will run automatically
npm run dev

# Note: cleanup() function will be called automatically when script exits
