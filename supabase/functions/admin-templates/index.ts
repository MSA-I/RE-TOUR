/**
 * Edge Function: admin-templates
 * 
 * Administrative actions for system prompt templates:
 * - list: View all templates or filter by type
 * - reset: Regenerate a specific template
 * - history: View version history for a template type
 * - deactivate: Deactivate a specific template version
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clearTemplateCache, getOppositeViewTemplate } from "../_shared/template-loader.ts";

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
    const body = await req.json().catch(() => ({}));
    const { action, template_type } = body;

    console.log(`[admin-templates] Action: ${action}, Type: ${template_type}`);

    switch (action) {
      // ═══════════════════════════════════════════════════════════════════════════
      // LIST: View all templates or filter by type
      // ═══════════════════════════════════════════════════════════════════════════
      case "list": {
        let query = serviceClient
          .from("system_prompt_templates")
          .select("*")
          .order("created_at", { ascending: false });

        if (template_type) {
          query = query.eq("template_type", template_type);
        }

        const { data: templates, error } = await query;

        if (error) {
          return new Response(
            JSON.stringify({ error: "Failed to fetch templates", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            action: "list",
            count: templates?.length || 0,
            templates: templates?.map((t) => ({
              id: t.id,
              type: t.template_type,
              version: t.template_version,
              is_active: t.is_active,
              generated_by_ai: t.generated_by_ai,
              description: t.description,
              content_preview: t.template_content?.substring(0, 100) + "...",
              placeholders: t.placeholders,
              created_at: t.created_at,
              updated_at: t.updated_at,
            })),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // RESET: Regenerate a template via AI
      // ═══════════════════════════════════════════════════════════════════════════
      case "reset": {
        if (!template_type) {
          return new Response(
            JSON.stringify({ error: "template_type is required for reset" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Clear cache
        clearTemplateCache();

        // Get current max version
        const { data: currentVersions } = await serviceClient
          .from("system_prompt_templates")
          .select("template_version")
          .eq("template_type", template_type)
          .order("template_version", { ascending: false })
          .limit(1);

        const nextVersion = (currentVersions?.[0]?.template_version || 0) + 1;

        // Deactivate all existing templates of this type
        await serviceClient
          .from("system_prompt_templates")
          .update({ is_active: false })
          .eq("template_type", template_type);

        // Insert placeholder for regeneration
        const { error: insertError } = await serviceClient
          .from("system_prompt_templates")
          .insert({
            template_type,
            template_version: nextVersion,
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
            description: `Pending AI regeneration (v${nextVersion})`,
            generated_by_ai: false,
            is_active: false,
          });

        if (insertError) {
          return new Response(
            JSON.stringify({ error: "Failed to create placeholder", details: insertError.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Trigger generation (for opposite_view_template)
        if (template_type === "opposite_view_template") {
          const newTemplate = await getOppositeViewTemplate(serviceClient);
          return new Response(
            JSON.stringify({
              action: "reset",
              template_type,
              new_version: nextVersion,
              success: true,
              content_preview: newTemplate.substring(0, 200) + "...",
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            action: "reset",
            template_type,
            new_version: nextVersion,
            success: true,
            message: "Placeholder created. Template will be generated on next use.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // HISTORY: View version history for a template type
      // ═══════════════════════════════════════════════════════════════════════════
      case "history": {
        if (!template_type) {
          return new Response(
            JSON.stringify({ error: "template_type is required for history" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { data: history, error } = await serviceClient
          .from("system_prompt_templates")
          .select("*")
          .eq("template_type", template_type)
          .order("template_version", { ascending: false });

        if (error) {
          return new Response(
            JSON.stringify({ error: "Failed to fetch history", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            action: "history",
            template_type,
            versions: history?.map((t) => ({
              id: t.id,
              version: t.template_version,
              is_active: t.is_active,
              generated_by_ai: t.generated_by_ai,
              created_at: t.created_at,
              content_length: t.template_content?.length,
            })),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // DEACTIVATE: Deactivate a specific template by ID
      // ═══════════════════════════════════════════════════════════════════════════
      case "deactivate": {
        const { template_id } = body;
        if (!template_id) {
          return new Response(
            JSON.stringify({ error: "template_id is required for deactivate" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        clearTemplateCache();

        const { error } = await serviceClient
          .from("system_prompt_templates")
          .update({ is_active: false })
          .eq("id", template_id);

        if (error) {
          return new Response(
            JSON.stringify({ error: "Failed to deactivate", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            action: "deactivate",
            template_id,
            success: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // ACTIVATE: Activate a specific template by ID (deactivates others of same type)
      // ═══════════════════════════════════════════════════════════════════════════
      case "activate": {
        const { template_id } = body;
        if (!template_id) {
          return new Response(
            JSON.stringify({ error: "template_id is required for activate" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get template type first
        const { data: template } = await serviceClient
          .from("system_prompt_templates")
          .select("template_type")
          .eq("id", template_id)
          .single();

        if (!template) {
          return new Response(
            JSON.stringify({ error: "Template not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        clearTemplateCache();

        // Deactivate all of same type
        await serviceClient
          .from("system_prompt_templates")
          .update({ is_active: false })
          .eq("template_type", template.template_type);

        // Activate the specified one
        const { error } = await serviceClient
          .from("system_prompt_templates")
          .update({ is_active: true })
          .eq("id", template_id);

        if (error) {
          return new Response(
            JSON.stringify({ error: "Failed to activate", details: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            action: "activate",
            template_id,
            template_type: template.template_type,
            success: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ 
            error: "Unknown action", 
            available_actions: ["list", "reset", "history", "deactivate", "activate"] 
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
  } catch (err) {
    console.error("[admin-templates] Error:", err);
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: err instanceof Error ? err.message : String(err) 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
