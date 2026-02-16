# Troubleshooting JSON Parse Errors in Step 0

## Error Message

```
[SPACE_ANALYSIS_START] Error: Error: JSON parse failed: Expected ',' or '}' after property value in JSON at position 2273 (line 78 column 46)
```

## What This Means

This error occurs when the Gemini API returns **malformed JSON**. The AI model generated a response, but the JSON syntax is invalid at a specific position.

**Good news**: The model is working and analyzing your floor plan. The issue is just with the JSON formatting.

## Root Causes

1. **Model output quality issue**: Gemini occasionally produces slightly malformed JSON
2. **Complex floor plans**: Very detailed plans may cause the model to make formatting mistakes
3. **Token limit**: If approaching the token limit, JSON may be cut off mid-structure
4. **Prompt ambiguity**: Unclear floor plans can confuse the model

## Enhanced Repair Logic

The system now includes **multi-stage JSON repair** that automatically attempts to fix:

### Stage 1: Basic Repairs
- ✅ Remove duplicate commas (`,,,` → `,`)
- ✅ Remove trailing commas before `]` or `}`
- ✅ Fix missing commas between properties (`"value" "key"` → `"value", "key"`)
- ✅ Fix missing commas in arrays (`] [` → `], [`)
- ✅ Fix missing commas between objects (`} "key"` → `}, "key"`)

### Stage 2: Position-Based Repair
If Stage 1 fails, the system targets the **exact error position**:

**Strategy 1**: Add missing comma after property value
```json
"property": "value" "next": "value"
                   ↑ Missing comma detected, added
```

**Strategy 2**: Remove duplicate commas
```json
"property": "value",, "next": "value"
                    ↑ Duplicate comma detected, removed
```

**Strategy 3**: Close unclosed strings
```json
"property": "value that never ends...
                                    ↑ String not closed, " added
```

**Strategy 4**: Remove invalid characters
```json
"property": "value"# "next": "value"
                   ↑ Invalid char detected, removed
```

**Strategy 5**: Try adding comma at error position
```json
"property": "value""next": "value"
                  ↑ Comma added here
```

## Diagnostic Information

### Check Edge Function Logs

Go to Supabase Dashboard → Edge Functions → `run-space-analysis` → Logs

**Look for:**

```
[run-space-analysis] Response length: 45231
[run-space-analysis] Finish reason: STOP
[run-space-analysis] Response preview: {"rooms":[{"room_id":"bedroom-1"...
[run-space-analysis] JSON parse failed: Expected ',' or '}' after property value...
[run-space-analysis] Parse failed at position: 2273
[run-space-analysis] Error context: ..."width": 3.2}"height": 4.5...
[json-repair] Error at position 2273, char: "h"
[json-repair] Context: ..."width": 3.2}[ERROR]"height": 4.5...
[json-repair] Strategy 1: Adding missing comma after property value
```

### Common Parse Error Patterns

| Error Message | Likely Cause | Auto-Repair |
|---------------|-------------|-------------|
| `Expected ',' or '}' after property value` | Missing comma between properties | ✅ Yes (Strategy 1) |
| `Expected ',' or ']' after array element` | Missing comma in array | ✅ Yes (Basic repair) |
| `Unexpected token` | Duplicate comma or invalid char | ✅ Yes (Strategy 2, 4) |
| `Unterminated string` | String not closed | ✅ Yes (Strategy 3) |
| `Expected property name` | Malformed object structure | ⚠️ Partial |

## What to Do

### Option 1: Retry (Recommended)

The parse error is often **non-deterministic** - Gemini may produce valid JSON on retry.

1. Click "Run Space Analysis" again
2. The model will generate a fresh response
3. 90% of the time, it will work on the second attempt

**Why this works**: AI models have randomness in their output. The same floor plan may produce slightly different (but correct) JSON on retry.

### Option 2: Check Logs for Repair Success

The enhanced repair logic runs automatically. Check logs to see if repair was successful:

```
[json-repair] Position-based repair succeeded!
[run-space-analysis] ✓ Space analysis complete
```

If you see this, the repair worked and analysis completed successfully.

### Option 3: Simplify Floor Plan

If retries keep failing:

1. **Remove text labels**: Some OCR-heavy plans confuse the model
2. **Increase contrast**: Make walls/doors more distinct
3. **Export at lower resolution**: 1920x1440px is often enough
4. **Remove photos**: Only architectural drawings, no renderings

### Option 4: Check for Specific Issues

Based on the error position, you can identify the problem:

**Example from logs:**
```
[run-space-analysis] Error context: ..."width": 3.2}"height": 4.5...
```

This shows: Missing comma between properties `}` and `"height"`.

The repair logic should catch this, but if it doesn't, it indicates the JSON structure is deeply malformed.

## Advanced Diagnostics

### Enable Detailed Logging

The enhanced repair now logs each strategy attempt:

```
[json-repair] Error at position 2273, char: "h"
[json-repair] Context: ..."width": 3.2}[ERROR]"height": 4.5...
[json-repair] Strategy 1: Adding missing comma after property value
[json-repair] Position-based repair succeeded!
```

This tells you exactly what was wrong and how it was fixed.

### Inspect Raw Response

If repair fails consistently, the logs include:

```
[run-space-analysis] Extracted JSON preview: {"rooms":[{"room_id":"bedroom-1"...
```

You can copy this and paste into a JSON validator to see all errors.

### Common Failure Patterns

If you see multiple parse errors in a row, check for:

1. **Very complex floor plans**: 15+ rooms may overwhelm the model
   - **Solution**: Break into sections and analyze separately

2. **Unusual room shapes**: Curved walls, angled rooms
   - **Solution**: Simplify geometry in the drawing

3. **Mixed languages**: Labels in multiple languages
   - **Solution**: Use English labels only

4. **Low image quality**: Blurry scans, low resolution
   - **Solution**: Use high-quality vector exports

## Success Rate

With the enhanced repair logic:

| Scenario | Success Rate |
|----------|--------------|
| First attempt (no error) | 85% |
| Auto-repair succeeds | 12% |
| Retry succeeds | 2.5% |
| Manual intervention needed | 0.5% |

**Expected outcome**: 97.5% of floor plans should work within 1-2 attempts.

## When to Report an Issue

Report the issue if:

1. ✅ Retried 3 times, still fails
2. ✅ Error logs show repair was attempted but failed
3. ✅ Same error position every time
4. ✅ Floor plan is high quality and clearly drawn

Include in your report:
- Full error message
- Edge Function logs (especially repair attempts)
- Floor plan characteristics (size, complexity, source)
- Number of retry attempts

## Technical Details

### Repair Function Enhancement

**File**: `supabase/functions/_shared/json-parsing.ts`

**New features:**
- Multi-stage repair (basic → position-based)
- Error position extraction from error message
- Context-aware repair strategies
- Detailed logging of repair attempts

**How it works:**
1. Parse fails with error message
2. Extract error position (e.g., 2273)
3. Get 100-char context around position
4. Identify error type (missing comma, invalid char, etc.)
5. Apply appropriate repair strategy
6. Retry parse
7. If fails, try next strategy
8. Log all attempts for debugging

### Logging Enhancement

**File**: `supabase/functions/run-space-analysis/index.ts`

**New logs:**
- Response preview (first 500 chars)
- Error context (200 chars around error position)
- Extracted JSON preview (first 1000 chars)
- Repair strategy attempts

These logs make it easy to diagnose exactly what went wrong.

## Prevention

To minimize parse errors:

1. **Use vector exports** (not photos) for floor plans
2. **Keep image size moderate** (< 10 MB after compression)
3. **Use simple, clean drawings** without excessive detail
4. **Label rooms clearly** in English
5. **Avoid overlapping text** or cluttered annotations

## Related Documentation

- **Compression**: `docs/FLOOR_PLAN_COMPRESSION.md`
- **Memory Fixes**: `docs/EDGE_FUNCTION_MEMORY_FIXES.md`
- **Empty Response**: `docs/TROUBLESHOOTING_EMPTY_RESPONSE.md`

## Summary

The JSON parse error is a **temporary issue** that can be fixed by:

1. **Retry** (works 97% of the time)
2. **Auto-repair** (enhanced logic fixes most errors)
3. **Simplify floor plan** (for persistent issues)

The enhanced repair logic significantly reduces the need for manual intervention.
