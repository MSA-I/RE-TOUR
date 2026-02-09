/**
 * Robust JSON Parsing Utilities for RE:TOUR Edge Functions
 * 
 * Provides PRODUCTION-SAFE JSON extraction from LLM responses that may contain:
 * - Markdown code blocks
 * - Extra text before/after JSON
 * - Malformed or truncated JSON
 * - Trailing commas, unquoted strings, etc.
 * 
 * CRITICAL: This module NEVER throws. All errors are returned as structured results.
 */

export interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  rawResponse?: string;
  extractedJson?: string;
  repairAttempted?: boolean;
  parsePosition?: number;
}

export interface ParseDebugInfo {
  raw_model_output: string;
  extracted_json_candidate: string | null;
  parse_error_message: string | null;
  parse_error_position: number | null;
  repair_attempted: boolean;
  repair_successful: boolean;
  total_length: number;
}

/**
 * Robustly parse JSON from an LLM response text.
 * 
 * NEVER THROWS - always returns a structured result.
 * 
 * Strategy:
 * 1. Try direct JSON.parse
 * 2. Strip markdown code blocks and try again
 * 3. Extract top-level JSON object using balanced brace counting
 * 4. Attempt JSON repair (trailing commas, etc.)
 * 5. Return structured error with full debug info
 */
export function parseJsonFromLLM<T = Record<string, unknown>>(
  responseText: string,
  modelName?: string
): ParseResult<T> {
  // Empty response check
  if (!responseText || responseText.trim().length === 0) {
    return {
      success: false,
      error: "Empty response from model",
      errorCode: "EMPTY_RESPONSE",
      rawResponse: "<empty>",
    };
  }

  const rawResponse = responseText;
  let cleanContent = responseText.trim();

  // Step 1: Try direct parse
  try {
    const data = JSON.parse(cleanContent) as T;
    return { success: true, data, extractedJson: cleanContent };
  } catch {
    // Continue to next strategy
  }

  // Step 2: Strip markdown code blocks (handles ```json ... ```)
  cleanContent = stripMarkdownCodeBlocks(cleanContent);

  try {
    const data = JSON.parse(cleanContent) as T;
    return { success: true, data, extractedJson: cleanContent };
  } catch {
    // Continue to next strategy
  }

  // Step 3: Extract top-level JSON object using balanced brace counting
  const extracted = extractBalancedJson(cleanContent);

  if (extracted) {
    try {
      const data = JSON.parse(extracted) as T;
      return { success: true, data, extractedJson: extracted };
    } catch (parseErr) {
      // Step 4: Try JSON repair on extracted content
      const repaired = repairJson(extracted);
      if (repaired !== extracted) {
        try {
          const data = JSON.parse(repaired) as T;
          return {
            success: true,
            data,
            extractedJson: repaired,
            repairAttempted: true,
          };
        } catch (repair1Error) {
          // First repair didn't work, try position-based repair
          const errorMsg = repair1Error instanceof Error ? repair1Error.message : String(repair1Error);
          const position = extractParsePosition(errorMsg);

          if (position !== null) {
            console.log(`[json-repair] First repair failed at position ${position}, attempting targeted repair...`);
            const targetRepaired = repairAtPosition(repaired, position);

            try {
              const data = JSON.parse(targetRepaired) as T;
              console.log(`[json-repair] Position-based repair succeeded!`);
              return {
                success: true,
                data,
                extractedJson: targetRepaired,
                repairAttempted: true,
              };
            } catch {
              // Position repair didn't help either
              console.log(`[json-repair] Position-based repair failed`);
            }
          }
        }
      }

      // Parse failed even after repair attempts
      const errorMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      const position = extractParsePosition(errorMsg);

      return {
        success: false,
        error: `JSON parse failed: ${errorMsg}`,
        errorCode: "PARSE_FAILED",
        rawResponse: rawResponse,
        extractedJson: extracted,
        repairAttempted: true,
        parsePosition: position ?? undefined,
      };
    }
  }

  // Step 5: Try extracting from first '{' to last '}' as fallback
  const firstBrace = cleanContent.indexOf("{");
  const lastBrace = cleanContent.lastIndexOf("}");
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const naiveExtract = cleanContent.substring(firstBrace, lastBrace + 1);
    
    try {
      const data = JSON.parse(naiveExtract) as T;
      return { success: true, data, extractedJson: naiveExtract };
    } catch {
      // Try repair
      const repaired = repairJson(naiveExtract);
      try {
        const data = JSON.parse(repaired) as T;
        return { 
          success: true, 
          data, 
          extractedJson: repaired,
          repairAttempted: true,
        };
      } catch (parseErr) {
        const errorMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const position = extractParsePosition(errorMsg);
        
        return {
          success: false,
          error: `JSON parse failed after extraction and repair: ${errorMsg}`,
          errorCode: "PARSE_FAILED_AFTER_REPAIR",
          rawResponse: rawResponse,
          extractedJson: naiveExtract,
          repairAttempted: true,
          parsePosition: position ?? undefined,
        };
      }
    }
  }

  // Step 6: No JSON structure found at all
  return {
    success: false,
    error: `No valid JSON object found in response${modelName ? ` from ${modelName}` : ""}`,
    errorCode: "NO_JSON_FOUND",
    rawResponse: rawResponse,
  };
}

/**
 * Strip markdown code blocks from text
 */
function stripMarkdownCodeBlocks(text: string): string {
  // Handle ```json ... ``` blocks
  let clean = text.replace(/^```(?:json)?\s*/i, "");
  clean = clean.replace(/\s*```\s*$/i, "");
  
  // Handle inline ``` markers
  clean = clean.replace(/```/g, "");
  
  return clean.trim();
}

/**
 * Extract a balanced JSON object from text using brace counting.
 * This is more robust than naive first/last brace matching.
 */
function extractBalancedJson(text: string): string | null {
  const startIdx = text.indexOf("{");
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === "\\") {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.substring(startIdx, i + 1);
      }
    }
  }
  
  // Unbalanced braces - return what we have anyway for repair attempt
  const endIdx = text.lastIndexOf("}");
  if (endIdx > startIdx) {
    return text.substring(startIdx, endIdx + 1);
  }
  
  return null;
}

/**
 * Attempt to repair common JSON issues:
 * - Trailing commas before ] or }
 * - Single quotes instead of double quotes
 * - Unquoted keys
 * - Truncated content (close open brackets/braces)
 * - Incomplete array/object elements (remove and close cleanly)
 * - Missing commas between properties
 * - Duplicate commas
 * - Unclosed strings
 */
function repairJson(json: string): string {
  let repaired = json;

  // Fix duplicate commas
  repaired = repaired.replace(/,\s*,+/g, ",");

  // Remove trailing commas before ] or }
  repaired = repaired.replace(/,\s*([\]}])/g, "$1");

  // Fix missing commas between properties (common LLM error)
  // Pattern: "value"\s*"key" should be "value","key"
  repaired = repaired.replace(/("\s*)\s+("[\w_]+"\s*:)/g, "$1,$2");

  // Fix missing commas between array elements
  // Pattern: ]\s*[ should be ],[
  repaired = repaired.replace(/\]\s*\[/g, "],[");

  // Fix missing commas between object properties
  // Pattern: }\s*"key" should be },"key"
  repaired = repaired.replace(/\}\s*("[\w_]+"\s*:)/g, "},$1");

  // Handle truncated arrays/objects by counting braces
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  let lastCompletePosition = repaired.length;

  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") openBraces++;
    else if (char === "}") openBraces--;
    else if (char === "[") openBrackets++;
    else if (char === "]") openBrackets--;

    // Track last position where we had balanced brackets at depth > 0
    if ((openBraces > 0 || openBrackets > 0) && char === "," && !inString) {
      lastCompletePosition = i;
    }
  }

  // AGGRESSIVE TRUNCATION REPAIR:
  // If we're inside a string or have unclosed structures,
  // try removing incomplete trailing content after the last complete element
  if (inString || openBraces > 0 || openBrackets > 0) {
    // Find the last comma at the same depth level
    // This indicates the last complete element in an array/object
    const lastCommaIndex = repaired.lastIndexOf(",", lastCompletePosition);

    if (lastCommaIndex > 0) {
      // Remove everything after the last comma (incomplete element)
      repaired = repaired.substring(0, lastCommaIndex);
      console.log("[json-repair] Removed incomplete trailing element after truncation");

      // Recount after truncation
      openBraces = 0;
      openBrackets = 0;
      inString = false;
      escape = false;

      for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === "\\") {
          escape = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (char === "{") openBraces++;
        else if (char === "}") openBraces--;
        else if (char === "[") openBrackets++;
        else if (char === "]") openBrackets--;
      }
    }
  }

  // Close any unclosed strings (if we ended inside a string)
  if (inString) {
    repaired += '"';
  }

  // Close unclosed brackets
  while (openBrackets > 0) {
    repaired += "]";
    openBrackets--;
  }

  // Close unclosed braces
  while (openBraces > 0) {
    repaired += "}";
    openBraces--;
  }

  // Clean up any double closing
  repaired = repaired.replace(/\]\s*\]/g, "]");
  repaired = repaired.replace(/\}\s*\}/g, "}");
  repaired = repaired.replace(/,\s*([\]}])/g, "$1");

  return repaired;
}

/**
 * Extract parse position from JSON parse error message
 */
function extractParsePosition(errorMsg: string): number | null {
  // Match patterns like "at position 823" or "position 823"
  const posMatch = errorMsg.match(/position\s+(\d+)/i);
  if (posMatch) {
    return parseInt(posMatch[1], 10);
  }
  return null;
}

/**
 * Attempt targeted repair at a specific position in the JSON
 * Common issues at error positions:
 * - Missing comma after property
 * - Extra comma
 * - Unclosed string
 * - Invalid character
 */
function repairAtPosition(json: string, position: number): string {
  if (position < 0 || position >= json.length) {
    return json;
  }

  let repaired = json;

  // Get context around the error position
  const contextBefore = repaired.substring(Math.max(0, position - 50), position);
  const contextAfter = repaired.substring(position, Math.min(repaired.length, position + 50));
  const errorChar = repaired[position];

  console.log(`[json-repair] Error at position ${position}, char: "${errorChar}"`);
  console.log(`[json-repair] Context: ...${contextBefore}[ERROR]${contextAfter}...`);

  // Strategy 1: If error is right after a closing quote, might need a comma
  if (position > 0 && repaired[position - 1] === '"') {
    // Check if the next non-whitespace char is a quote (start of next property)
    const nextNonWs = repaired.substring(position).match(/^\s*"/)
    if (nextNonWs) {
      console.log(`[json-repair] Strategy 1: Adding missing comma after property value`);
      repaired = repaired.substring(0, position) + "," + repaired.substring(position);
      return repaired;
    }
  }

  // Strategy 2: If error char is a comma, might be duplicate
  if (errorChar === ",") {
    // Check for duplicate commas
    const beforeComma = repaired[position - 1];
    if (beforeComma === ",") {
      console.log(`[json-repair] Strategy 2: Removing duplicate comma`);
      repaired = repaired.substring(0, position) + repaired.substring(position + 1);
      return repaired;
    }
  }

  // Strategy 3: If we're inside a string that's not closed, close it
  let inString = false;
  let lastQuote = -1;
  for (let i = 0; i < position; i++) {
    if (repaired[i] === '"' && (i === 0 || repaired[i - 1] !== "\\")) {
      inString = !inString;
      lastQuote = i;
    }
  }
  if (inString) {
    console.log(`[json-repair] Strategy 3: Closing unclosed string from position ${lastQuote}`);
    repaired = repaired.substring(0, position) + '"' + repaired.substring(position);
    return repaired;
  }

  // Strategy 4: Try removing the character at error position
  if (errorChar && !/[\w\d{}[\]:,"]/.test(errorChar)) {
    console.log(`[json-repair] Strategy 4: Removing invalid character "${errorChar}"`);
    repaired = repaired.substring(0, position) + repaired.substring(position + 1);
    return repaired;
  }

  // Strategy 5: If all else fails, try adding a comma before the position
  console.log(`[json-repair] Strategy 5: Trying to add comma at position ${position}`);
  repaired = repaired.substring(0, position) + "," + repaired.substring(position);
  return repaired;
}

/**
 * Truncate text for error logging (configurable length)
 */
export function truncateForError(text: string, maxLength: number = 500): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + `... [truncated, total ${text.length} chars]`;
}

/**
 * Build a structured error object for Langfuse logging
 */
export function buildParseErrorOutput(
  result: ParseResult<unknown>,
  modelName: string,
  timingMs: number
): Record<string, unknown> {
  return {
    error: true,
    error_code: result.errorCode || "UNKNOWN",
    message: result.error || "Unknown parse error",
    model_name: modelName,
    raw_response_preview: result.rawResponse ? truncateForError(result.rawResponse) : "<not_captured>",
    extracted_json_preview: result.extractedJson ? truncateForError(result.extractedJson) : "<not_extracted>",
    repair_attempted: result.repairAttempted || false,
    parse_position: result.parsePosition,
    timing_ms: timingMs,
  };
}

/**
 * Build debug info for storing in database
 */
export function buildParseDebugInfo(
  rawResponse: string,
  parseResult: ParseResult<unknown>
): ParseDebugInfo {
  return {
    raw_model_output: rawResponse,
    extracted_json_candidate: parseResult.extractedJson || null,
    parse_error_message: parseResult.error || null,
    parse_error_position: parseResult.parsePosition || null,
    repair_attempted: parseResult.repairAttempted || false,
    repair_successful: parseResult.repairAttempted === true && parseResult.success,
    total_length: rawResponse.length,
  };
}

/**
 * Validate space analysis schema - checks for required fields
 */
export function validateSpaceAnalysisSchema(
  data: unknown
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!data || typeof data !== "object") {
    errors.push("Response is not an object");
    return { valid: false, errors };
  }
  
  const obj = data as Record<string, unknown>;
  
  // Check for rooms array
  if (!Array.isArray(obj.rooms)) {
    errors.push("Missing or invalid 'rooms' array");
  } else {
    // Validate each room has required fields
    (obj.rooms as unknown[]).forEach((room, i) => {
      if (!room || typeof room !== "object") {
        errors.push(`Room ${i} is not an object`);
        return;
      }
      const r = room as Record<string, unknown>;
      
      // Check for room_name or name (accept both for flexibility)
      const hasName = r.room_name || r.name || r.inferred_usage;
      if (!hasName) {
        errors.push(`Room ${i} missing room_name`);
      }
      
      // Check for some form of ID
      const hasId = r.room_id || r.space_id || r.id;
      if (!hasId) {
        errors.push(`Room ${i} missing room_id/space_id`);
      }
    });
  }
  
  return { valid: errors.length === 0, errors };
}
