import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Info,
  AlertTriangle,
  Shield,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export type StrengthStage = "nudge" | "check" | "guard" | "law";

interface TriggeredRule {
  id: string;
  rule_text: string;
  category: string;
  strength_stage: StrengthStage;
  health: number;
  confidence_score: number;
}

interface QAProgressiveWarningProps {
  triggeredRules: TriggeredRule[];
  onProceed: (overrideReasons?: Map<string, string>) => void;
  onCancel: () => void;
}

/**
 * Progressive Warning System
 * Shows different UI based on rule strength:
 * - Nudge: Passive hint
 * - Check: Requires confirmation checkbox
 * - Guard: Soft block with override reason
 * - Law: Hard block, cannot proceed
 */
export function QAProgressiveWarning({
  triggeredRules,
  onProceed,
  onCancel,
}: QAProgressiveWarningProps) {
  const [overrideReasons, setOverrideReasons] = useState<Map<string, string>>(new Map());
  const [confirmChecks, setConfirmChecks] = useState<Map<string, boolean>>(new Map());
  const [showDialog, setShowDialog] = useState(true);

  // Group rules by strength
  const lawRules = triggeredRules.filter(r => r.strength_stage === "law");
  const guardRules = triggeredRules.filter(r => r.strength_stage === "guard");
  const checkRules = triggeredRules.filter(r => r.strength_stage === "check");
  const nudgeRules = triggeredRules.filter(r => r.strength_stage === "nudge");

  const hasBlockingRules = lawRules.length > 0;
  const hasGuardRules = guardRules.length > 0;
  const hasCheckRules = checkRules.length > 0;

  // Check if all required fields are filled
  const canProceed = (): boolean => {
    if (hasBlockingRules) return false; // Cannot override law rules

    // All guard rules need override reasons
    for (const rule of guardRules) {
      const reason = overrideReasons.get(rule.id);
      if (!reason || reason.trim().length < 10) {
        return false;
      }
    }

    // All check rules need confirmation
    for (const rule of checkRules) {
      if (!confirmChecks.get(rule.id)) {
        return false;
      }
    }

    return true;
  };

  const handleProceed = () => {
    if (canProceed()) {
      setShowDialog(false);
      onProceed(overrideReasons);
    }
  };

  const handleCancel = () => {
    setShowDialog(false);
    onCancel();
  };

  const getStageIcon = (stage: StrengthStage) => {
    switch (stage) {
      case "nudge":
        return <Info className="w-5 h-5 text-blue-500" />;
      case "check":
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case "guard":
        return <Shield className="w-5 h-5 text-orange-500" />;
      case "law":
        return <XCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStageColor = (stage: StrengthStage) => {
    switch (stage) {
      case "nudge":
        return "border-blue-500/50";
      case "check":
        return "border-yellow-500/50";
      case "guard":
        return "border-orange-500/50";
      case "law":
        return "border-red-500/50";
    }
  };

  return (
    <Dialog open={showDialog} onOpenChange={setShowDialog}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {hasBlockingRules ? (
              <>
                <XCircle className="w-5 h-5 text-red-500" />
                Cannot Proceed
              </>
            ) : hasGuardRules ? (
              <>
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                Warning: High Risk of Rejection
              </>
            ) : hasCheckRules ? (
              <>
                <AlertCircle className="w-5 h-5 text-yellow-500" />
                Please Confirm
              </>
            ) : (
              <>
                <Info className="w-5 h-5 text-blue-500" />
                Helpful Tips
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {hasBlockingRules
              ? "The following issues must be fixed before proceeding"
              : hasGuardRules
              ? "You can proceed, but we strongly recommend addressing these issues first"
              : hasCheckRules
              ? "Please confirm you've checked these items"
              : "Keep these tips in mind for better results"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Law Rules (Hard Blocks) */}
          {lawRules.map(rule => (
            <Card key={rule.id} className={`p-4 ${getStageColor(rule.strength_stage)}`}>
              <div className="flex items-start gap-3">
                {getStageIcon(rule.strength_stage)}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="destructive" className="text-xs">
                      ERROR
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {rule.category}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium">{rule.rule_text}</p>
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      This is a hard rule and cannot be overridden. Please fix the issue and try again.
                    </AlertDescription>
                  </Alert>
                </div>
              </div>
            </Card>
          ))}

          {/* Guard Rules (Soft Blocks) */}
          {guardRules.map(rule => (
            <Card key={rule.id} className={`p-4 ${getStageColor(rule.strength_stage)}`}>
              <div className="flex items-start gap-3">
                {getStageIcon(rule.strength_stage)}
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-500">
                      WARNING
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {rule.category}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      Confidence: {(rule.confidence_score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-sm font-medium">{rule.rule_text}</p>
                  <div className="space-y-2">
                    <Label htmlFor={`override-${rule.id}`} className="text-xs">
                      If you're sure this is correct, explain why (minimum 10 characters):
                    </Label>
                    <Textarea
                      id={`override-${rule.id}`}
                      placeholder="E.g., 'This is a special case because...'"
                      className="text-sm"
                      rows={2}
                      value={overrideReasons.get(rule.id) || ""}
                      onChange={e => {
                        const newReasons = new Map(overrideReasons);
                        newReasons.set(rule.id, e.target.value);
                        setOverrideReasons(newReasons);
                      }}
                    />
                  </div>
                </div>
              </div>
            </Card>
          ))}

          {/* Check Rules (Confirmations) */}
          {checkRules.map(rule => (
            <Card key={rule.id} className={`p-4 ${getStageColor(rule.strength_stage)}`}>
              <div className="flex items-start gap-3">
                {getStageIcon(rule.strength_stage)}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-500">
                      CHECK
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {rule.category}
                    </Badge>
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={`check-${rule.id}`}
                      checked={confirmChecks.get(rule.id) || false}
                      onCheckedChange={checked => {
                        const newChecks = new Map(confirmChecks);
                        newChecks.set(rule.id, checked as boolean);
                        setConfirmChecks(newChecks);
                      }}
                    />
                    <Label
                      htmlFor={`check-${rule.id}`}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {rule.rule_text}
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground ml-6">
                    This issue caused a rejection last time. Please verify it's addressed.
                  </p>
                </div>
              </div>
            </Card>
          ))}

          {/* Nudge Rules (Hints) */}
          {nudgeRules.map(rule => (
            <Card key={rule.id} className={`p-4 ${getStageColor(rule.strength_stage)}`}>
              <div className="flex items-start gap-3">
                {getStageIcon(rule.strength_stage)}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-500">
                      TIP
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {rule.category}
                    </Badge>
                  </div>
                  <p className="text-sm">{rule.rule_text}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCancel}>
            {hasBlockingRules ? "Go Back and Fix" : "Cancel"}
          </Button>
          {!hasBlockingRules && (
            <Button
              onClick={handleProceed}
              disabled={!canProceed()}
              variant={hasGuardRules ? "destructive" : "default"}
            >
              {hasGuardRules
                ? "Proceed Anyway (Risk of Rejection)"
                : hasCheckRules
                ? "Confirmed, Proceed"
                : "Understood, Continue"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
