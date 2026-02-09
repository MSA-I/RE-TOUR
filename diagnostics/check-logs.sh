#!/bin/bash

# Quick script to check Supabase function logs
# This will show recent errors from the run-space-analysis function

echo "Fetching recent logs from run-space-analysis function..."
echo ""
echo "Go to:"
echo "https://supabase.com/dashboard/project/zturojwgqtjrxwsfbwqw/functions/run-space-analysis/logs"
echo ""
echo "Or use Supabase CLI:"
npx supabase functions logs run-space-analysis --limit 50

echo ""
echo "Look for:"
echo "  - SyntaxError"
echo "  - ReferenceError"
echo "  - TypeError"
echo "  - VERSION: 2.1.0-transform-fix (to confirm deployment)"
echo ""
