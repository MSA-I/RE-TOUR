import { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// STRUCTURED QA EXPLANATION DISPLAY
// Shows detailed architectural reasoning organized by category
// ============================================================================

interface CheckItem {
  check: string;
  result: "pass" | "fail" | string;
  evidence: string;
}

export interface QAExplanationData {
  verdict: "approved" | "rejected" | string;
  confidence: number;
  summary: string;
  architecture_checks?: CheckItem[];
  materials_checks?: CheckItem[];
  furniture_checks?: CheckItem[];
  scale_and_layout?: CheckItem[];
  artifacts_and_ai_issues?: CheckItem[];
  notes_for_next_step?: string | null;
  rejection_reasons?: string[];
}

interface StructuredQAExplanationProps {
  explanation: QAExplanationData | null | undefined;
  compact?: boolean;
}

function CheckSection({ 
  title, 
  checks, 
  icon: Icon 
}: { 
  title: string; 
  checks: CheckItem[] | undefined;
  icon: React.ComponentType<{ className?: string }>;
}) {
  if (!checks || checks.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="space-y-1 pl-5">
        {checks.map((item, i) => {
          const isPassed = item.result === "pass" || item.result === "passed";
          return (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 flex-shrink-0 uppercase",
                  isPassed 
                    ? "text-primary border-primary/50" 
                    : "text-destructive border-destructive/50"
                )}
              >
                {isPassed ? "✓" : "✗"}
              </Badge>
              <div className="flex-1 min-w-0">
                <span className="font-medium">{item.check}:</span>{" "}
                <span className="text-muted-foreground">{item.evidence}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const StructuredQAExplanation = memo(function StructuredQAExplanation({
  explanation,
  compact = false,
}: StructuredQAExplanationProps) {
  if (!explanation) {
    return (
      <div className="p-3 bg-muted/30 rounded-lg">
        <p className="text-sm text-muted-foreground italic">
          Legacy output — no stored QA rationale
        </p>
      </div>
    );
  }

  const isApproved = explanation.verdict === "approved";

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className={cn(
        "p-3 rounded-lg border",
        isApproved 
          ? "bg-primary/5 border-primary/30" 
          : "bg-destructive/5 border-destructive/30"
      )}>
        <div className="flex items-start gap-2">
          {isApproved ? (
            <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium">
                {isApproved ? "Why QA Approved" : "Why QA Rejected"}
              </span>
              {explanation.confidence > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {(explanation.confidence * 100).toFixed(0)}% confidence
                </Badge>
              )}
            </div>
            <p className="text-sm">{explanation.summary}</p>
          </div>
        </div>
      </div>

      {/* Rejection reasons (prominent for rejected) */}
      {!isApproved && explanation.rejection_reasons && explanation.rejection_reasons.length > 0 && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="text-xs font-medium text-destructive">Issues Found:</span>
              <ul className="text-xs space-y-0.5">
                {explanation.rejection_reasons.map((reason, i) => (
                  <li key={i} className="text-destructive-foreground">• {reason}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Detailed checks (collapsible in compact mode) */}
      {!compact && (
        <div className="space-y-3 pt-2 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground">Detailed Verification:</p>
          
          <CheckSection 
            title="Architecture" 
            checks={explanation.architecture_checks} 
            icon={({ className }) => <span className={className}>🏗️</span>}
          />
          
          <CheckSection 
            title="Materials & Textures" 
            checks={explanation.materials_checks}
            icon={({ className }) => <span className={className}>🎨</span>}
          />
          
          <CheckSection 
            title="Furniture & Fixtures" 
            checks={explanation.furniture_checks}
            icon={({ className }) => <span className={className}>🛋️</span>}
          />
          
          <CheckSection 
            title="Scale & Layout" 
            checks={explanation.scale_and_layout}
            icon={({ className }) => <span className={className}>📐</span>}
          />
          
          <CheckSection 
            title="AI Artifacts" 
            checks={explanation.artifacts_and_ai_issues}
            icon={({ className }) => <span className={className}>🔍</span>}
          />
        </div>
      )}

      {/* Notes for next step */}
      {explanation.notes_for_next_step && (
        <div className="text-xs text-muted-foreground italic pt-2 border-t border-border/50">
          <span className="font-medium">Note for next step:</span> {explanation.notes_for_next_step}
        </div>
      )}
    </div>
  );
});
