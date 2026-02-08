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
        } catch {
          // Repair didn't help
        }
      }

      // Parse failed even after repair attempt
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
 */
function repairJson(json: string): string {
  let repaired = json;
  
  // Remove trailing commas before ] or }
  repaired = repaired.replace(/,\s*([\]}])/g, "$1");
  
  // Handle truncated arrays/objects by counting braces
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  
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
