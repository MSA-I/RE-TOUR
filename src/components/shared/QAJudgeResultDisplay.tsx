import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, AlertCircle, CheckCircle, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QAJudgeResult } from "@/hooks/useQAJudgeResults";
import { toast } from "sonner";

interface QAJudgeResultDisplayProps {
  result: QAJudgeResult;
  className?: string;
  showFullDetails?: boolean;
}

/**
 * Displays a single QA Judge result with pass/fail status,
 * reasons, violated rules, and expandable full JSON details.
 */
export function QAJudgeResultDisplay({
  result,
  className,
  showFullDetails = true,
}: QAJudgeResultDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);

  const copyFullResult = () => {
    navigator.clipboard.writeText(JSON.stringify(result.full_result, null, 2));
    toast.success("Full result copied to clipboard");
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        result.pass
          ? "border-primary/30 bg-primary/5"
          : "border-destructive/30 bg-destructive/5",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {result.pass ? (
            <CheckCircle className="h-5 w-5 text-primary" />
          ) : (
            <AlertCircle className="h-5 w-5 text-destructive" />
          )}
          <Badge variant={result.pass ? "default" : "destructive"}>
            {result.pass ? "PASS" : "FAIL"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Attempt {result.attempt_index}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {result.score !== null && (
            <Badge variant="outline" className="font-mono">
              Score: {result.score.toFixed(1)}
            </Badge>
          )}
          {result.confidence !== null && (
            <Badge variant="outline" className="font-mono">
              Conf: {(result.confidence * 100).toFixed(0)}%
            </Badge>
          )}
          {result.ab_bucket && (
            <Badge variant="secondary">Bucket {result.ab_bucket}</Badge>
          )}
        </div>
      </div>

      {/* Reasons */}
      {result.reasons.length > 0 && (
        <div className="mb-3">
          <h4 className="text-sm font-medium mb-1">Reasons:</h4>
          <ul className="list-disc list-inside space-y-1">
            {result.reasons.map((reason, idx) => (
              <li key={idx} className="text-sm text-muted-foreground">
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Violated Rules */}
      {result.violated_rules.length > 0 && (
        <div className="mb-3">
          <h4 className="text-sm font-medium mb-1 text-destructive">
            Violated Rules:
          </h4>
          <div className="flex flex-wrap gap-1">
            {result.violated_rules.map((rule, idx) => (
              <Badge key={idx} variant="destructive" className="text-xs">
                {rule}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Model Info */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <span>Model: {result.judge_model}</span>
        {result.prompt_name && (
          <>
            <span>•</span>
            <span>
              Prompt: {result.prompt_name}
              {result.prompt_version && ` v${result.prompt_version}`}
            </span>
          </>
        )}
        {result.processing_time_ms && (
          <>
            <span>•</span>
            <span>{result.processing_time_ms}ms</span>
          </>
        )}
      </div>

      {/* Expandable Full Result */}
      {showFullDetails && Object.keys(result.full_result).length > 0 && (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 mr-2" />
              ) : (
                <ChevronRight className="h-4 w-4 mr-2" />
              )}
              Show Full Result JSON
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-6 w-6"
                onClick={copyFullResult}
              >
                <Copy className="h-3 w-3" />
              </Button>
              <pre className="p-3 bg-muted/50 rounded-md text-xs overflow-auto max-h-64 font-mono">
                {JSON.stringify(result.full_result, null, 2)}
              </pre>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

interface QAJudgeResultsListProps {
  results: QAJudgeResult[];
  className?: string;
  emptyMessage?: string;
}

/**
 * Displays a list of QA Judge results
 */
export function QAJudgeResultsList({
  results,
  className,
  emptyMessage = "No QA results available",
}: QAJudgeResultsListProps) {
  if (results.length === 0) {
    return (
      <div className={cn("text-center text-muted-foreground py-4", className)}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      {results.map((result) => (
        <QAJudgeResultDisplay key={result.id} result={result} />
      ))}
    </div>
  );
}

interface QAJudgeSummaryBadgeProps {
  pass: boolean;
  reasons: string[];
  className?: string;
}

/**
 * Compact badge showing QA status with tooltip-style reasons
 */
export function QAJudgeSummaryBadge({
  pass,
  reasons,
  className,
}: QAJudgeSummaryBadgeProps) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <Badge
        variant={pass ? "default" : "destructive"}
        className="shrink-0"
      >
        {pass ? "PASS" : "FAIL"}
      </Badge>
      {!pass && reasons.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {reasons.slice(0, 2).map((reason, i) => (
            <div key={i} className="line-clamp-1">
              • {reason}
            </div>
          ))}
          {reasons.length > 2 && (
            <div className="text-xs opacity-70">
              +{reasons.length - 2} more...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
