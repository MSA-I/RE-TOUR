/**
 * Edge Function: get-opposite-view-template
 * 
 * Retrieves or generates (one-time) the centralized opposite-view prompt template.
 * This template is used for all Camera B renders across the system.
 * 
 * Usage:
 * - GET: Returns the current active template
 * - POST with { force_regenerate: true }: Regenerates the template via AI
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  getOppositeViewTemplate, 
  DEFAULT_OPPOSITE_VIEW_TEMPLATE,
  clearTemplateCache 
} from "../_shared/template-loader.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Handle POST for force regeneration
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      
      if (body.force_regenerate) {
        console.log("[get-opposite-view-template] Force regeneration requested");
        
        // Clear cache
        clearTemplateCache();
        
        // Deactivate existing templates
        await serviceClient
          .from("system_prompt_templates")
          .update({ is_active: false })
          .eq("template_type", "opposite_view_template");
        
        // Insert placeholder to trigger regeneration
        await serviceClient
          .from("system_prompt_templates")
          .insert({
            template_type: "opposite_view_template",
            template_version: 1, // Will be incremented by trigger or manually
            template_content: "PENDING_AI_GENERATION",
            placeholders: [
              "{{camera_position}}",
              "{{yaw_opposite}}",
              "{{floor_plan}}",
              "{{image_A}}",
              "{{constraints}}",
              "{{space_name}}",
              "{{space_type}}",
            ],
            description: "Pending AI regeneration",
            generated_by_ai: false,
            is_active: false,
          });
        
        // This will trigger AI generation
        const newTemplate = await getOppositeViewTemplate(serviceClient);
        
        return new Response(
          JSON.stringify({
            success: true,
            message: "Template regenerated",
            template_preview: newTemplate.substring(0, 200) + "...",
            is_default: newTemplate === DEFAULT_OPPOSITE_VIEW_TEMPLATE,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // GET: Return current template
    const template = await getOppositeViewTemplate(serviceClient);
    
    // Also fetch metadata from DB
    const { data: templateRecord } = await serviceClient
      .from("system_prompt_templates")
      .select("*")
      .eq("template_type", "opposite_view_template")
      .eq("is_active", true)
      .single();

    return new Response(
      JSON.stringify({
        template_type: "opposite_view_template",
        template_content: template,
        is_default: template === DEFAULT_OPPOSITE_VIEW_TEMPLATE,
        metadata: templateRecord ? {
          id: templateRecord.id,
          version: templateRecord.template_version,
          generated_by_ai: templateRecord.generated_by_ai,
          created_at: templateRecord.created_at,
          updated_at: templateRecord.updated_at,
          placeholders: templateRecord.placeholders,
        } : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[get-opposite-view-template] Error:", err);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: err instanceof Error ? err.message : String(err) 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
