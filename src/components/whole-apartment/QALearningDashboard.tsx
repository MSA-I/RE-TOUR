import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Brain,
  Shield,
  AlertTriangle,
  Info,
  Volume2,
  VolumeX,
  Lock,
  Unlock,
  Trash2,
  RotateCcw,
  TrendingDown,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QAPolicyRule {
  id: string;
  category: string;
  rule_text: string;
  strength_stage: "nudge" | "check" | "guard" | "law";
  health: number;
  confidence_score: number;
  violation_count: number;
  user_muted: boolean;
  user_locked: boolean;
  scope_level: string;
  step_id: number | null;
}

/**
 * QA Learning Dashboard
 * User interface for viewing and managing learned QA rules
 */
export function QALearningDashboard() {
  const { toast } = useToast();
  const [rules, setRules] = useState<QAPolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showResetDialog, setShowResetDialog] = useState(false);

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { data, error } = await supabase
        .from("qa_policy_rules")
        .select("*")
        .eq("owner_id", user.user.id)
        .eq("rule_status", "active")
        .order("strength_stage", { ascending: false })
        .order("health", { ascending: false });

      if (error) throw error;
      setRules(data || []);
    } catch (error) {
      console.error("[QALearningDashboard] Error fetching rules:", error);
      toast({
        title: "Error",
        description: "Failed to load learning rules",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleMute = async (ruleId: string, currentlyMuted: boolean) => {
    try {
      const { error } = await supabase
        .from("qa_policy_rules")
        .update({ user_muted: !currentlyMuted })
        .eq("id", ruleId);

      if (error) throw error;

      toast({
        title: currentlyMuted ? "Rule Unmuted" : "Rule Muted",
        description: currentlyMuted
          ? "This rule will now be enforced again"
          : "This rule will no longer trigger warnings",
      });

      fetchRules();
    } catch (error) {
      console.error("[QALearningDashboard] Error toggling mute:", error);
      toast({
        title: "Error",
        description: "Failed to update rule",
        variant: "destructive",
      });
    }
  };

  const toggleLock = async (ruleId: string, currentlyLocked: boolean) => {
    try {
      const { error } = await supabase
        .from("qa_policy_rules")
        .update({ user_locked: !currentlyLocked })
        .eq("id", ruleId);

      if (error) throw error;

      toast({
        title: currentlyLocked ? "Rule Unlocked" : "Rule Locked",
        description: currentlyLocked
          ? "This rule can now decay naturally"
          : "This rule will be kept forever",
      });

      fetchRules();
    } catch (error) {
      console.error("[QALearningDashboard] Error toggling lock:", error);
      toast({
        title: "Error",
        description: "Failed to update rule",
        variant: "destructive",
      });
    }
  };

  const deleteRule = async (ruleId: string) => {
    try {
      const { error } = await supabase
        .from("qa_policy_rules")
        .update({ rule_status: "disabled" })
        .eq("id", ruleId);

      if (error) throw error;

      toast({
        title: "Rule Deleted",
        description: "This rule has been removed from your profile",
      });

      fetchRules();
    } catch (error) {
      console.error("[QALearningDashboard] Error deleting rule:", error);
      toast({
        title: "Error",
        description: "Failed to delete rule",
        variant: "destructive",
      });
    }
  };

  const resetProfile = async () => {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      const { error } = await supabase.functions.invoke("reset-learning-profile", {
        body: { userId: user.user.id },
      });

      if (error) throw error;

      toast({
        title: "Profile Reset",
        description: "All personal learning rules have been cleared",
      });

      setShowResetDialog(false);
      fetchRules();
    } catch (error) {
      console.error("[QALearningDashboard] Error resetting profile:", error);
      toast({
        title: "Error",
        description: "Failed to reset profile",
        variant: "destructive",
      });
    }
  };

  const getStrengthIcon = (stage: string) => {
    switch (stage) {
      case "nudge":
        return <Info className="w-4 h-4 text-blue-500" />;
      case "check":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "guard":
        return <Shield className="w-4 h-4 text-orange-500" />;
      case "law":
        return <Shield className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStrengthLabel = (stage: string) => {
    switch (stage) {
      case "nudge":
        return "Nudge (Hint)";
      case "check":
        return "Check (Confirmation)";
      case "guard":
        return "Guard (Soft Block)";
      case "law":
        return "Law (Hard Block)";
      default:
        return stage;
    }
  };

  const getHealthColor = (health: number): string => {
    if (health >= 70) return "text-green-500";
    if (health >= 40) return "text-yellow-500";
    return "text-red-500";
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.7) return "text-green-500";
    if (confidence >= 0.5) return "text-yellow-500";
    return "text-red-500";
  };

  // Group rules by strength stage
  const rulesByStage = {
    law: rules.filter(r => r.strength_stage === "law" && !r.user_muted),
    guard: rules.filter(r => r.strength_stage === "guard" && !r.user_muted),
    check: rules.filter(r => r.strength_stage === "check" && !r.user_muted),
    nudge: rules.filter(r => r.strength_stage === "nudge" && !r.user_muted),
    muted: rules.filter(r => r.user_muted),
  };

  const activeRulesCount = rules.filter(r => !r.user_muted).length;
  const mutedRulesCount = rules.filter(r => r.user_muted).length;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 animate-pulse" />
            My Active Rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading your learning rules...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                My Active Rules
              </CardTitle>
              <CardDescription>
                Rules the AI has learned from your feedback
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResetDialog(true)}
              disabled={activeRulesCount === 0}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Fresh Start
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-3xl font-bold">{activeRulesCount}</p>
              <p className="text-xs text-muted-foreground">Active Rules</p>
            </div>
            {mutedRulesCount > 0 && (
              <>
                <Separator orientation="vertical" className="h-12" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-muted-foreground">{mutedRulesCount}</p>
                  <p className="text-xs text-muted-foreground">Muted</p>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Info Alert */}
      {activeRulesCount === 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No active rules yet. As you provide feedback on QA results, the system will learn your preferences
            and create rules to help avoid repeated mistakes.
          </AlertDescription>
        </Alert>
      )}

      {/* Law Rules (Hard Blocks) */}
      {rulesByStage.law.length > 0 && (
        <Card className="border-red-500/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-500" />
              Law (Hard Blocks)
            </CardTitle>
            <CardDescription>These rules cannot be overridden</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rulesByStage.law.map(rule => (
              <RuleCard key={rule.id} rule={rule} onMute={toggleMute} onLock={toggleLock} onDelete={deleteRule} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Guard Rules (Soft Blocks) */}
      {rulesByStage.guard.length > 0 && (
        <Card className="border-orange-500/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-orange-500" />
              Guard (Soft Blocks)
            </CardTitle>
            <CardDescription>Warnings that can be overridden with reason</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rulesByStage.guard.map(rule => (
              <RuleCard key={rule.id} rule={rule} onMute={toggleMute} onLock={toggleLock} onDelete={deleteRule} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Check Rules (Confirmations) */}
      {rulesByStage.check.length > 0 && (
        <Card className="border-yellow-500/50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Check (Confirmations)
            </CardTitle>
            <CardDescription>Requires confirmation before proceeding</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rulesByStage.check.map(rule => (
              <RuleCard key={rule.id} rule={rule} onMute={toggleMute} onLock={toggleLock} onDelete={deleteRule} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Nudge Rules (Hints) */}
      {rulesByStage.nudge.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-500" />
              Nudge (Hints)
            </CardTitle>
            <CardDescription>Passive reminders that don't block</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rulesByStage.nudge.map(rule => (
              <RuleCard key={rule.id} rule={rule} onMute={toggleMute} onLock={toggleLock} onDelete={deleteRule} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Muted Rules */}
      {rulesByStage.muted.length > 0 && (
        <Card className="border-muted">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-muted-foreground">
              <VolumeX className="w-5 h-5" />
              Muted Rules
            </CardTitle>
            <CardDescription>Rules you've temporarily disabled</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rulesByStage.muted.map(rule => (
              <RuleCard key={rule.id} rule={rule} onMute={toggleMute} onLock={toggleLock} onDelete={deleteRule} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Reset Confirmation Dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Learning Profile?</AlertDialogTitle>
            <AlertDialogDescription>
              This will disable all your personal learning rules (User and Pipeline level).
              Global rules set by administrators will remain active.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={resetProfile} className="bg-destructive text-destructive-foreground">
              Reset Profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Individual rule card component
 */
function RuleCard({
  rule,
  onMute,
  onLock,
  onDelete,
}: {
  rule: QAPolicyRule;
  onMute: (id: string, currentlyMuted: boolean) => void;
  onLock: (id: string, currentlyLocked: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const getHealthColor = (health: number): string => {
    if (health >= 70) return "bg-green-500";
    if (health >= 40) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.7) return "text-green-500";
    if (confidence >= 0.5) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className={`p-4 rounded-lg border ${rule.user_muted ? "opacity-50 border-muted" : "border-border"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          {/* Rule Text */}
          <div className="flex items-start gap-2">
            <Badge variant="outline" className="text-xs">
              {rule.category}
            </Badge>
            <p className="text-sm font-medium flex-1">{rule.rule_text}</p>
          </div>

          {/* Health & Confidence */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Health:</span>
              <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${getHealthColor(rule.health)}`}
                  style={{ width: `${rule.health}%` }}
                />
              </div>
              <span className="font-mono">{rule.health}%</span>
            </div>

            <Separator orientation="vertical" className="h-4" />

            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Confidence:</span>
              <span className={`font-mono ${getConfidenceColor(rule.confidence_score)}`}>
                {(rule.confidence_score * 100).toFixed(0)}%
              </span>
            </div>

            <Separator orientation="vertical" className="h-4" />

            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Violations:</span>
              <Badge variant="secondary" className="text-xs">
                {rule.violation_count}
              </Badge>
            </div>
          </div>

          {/* Locked Indicator */}
          {rule.user_locked && (
            <div className="flex items-center gap-1 text-xs text-blue-500">
              <Lock className="w-3 h-3" />
              <span>Locked (won't decay)</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMute(rule.id, rule.user_muted)}
            title={rule.user_muted ? "Unmute rule" : "Mute rule"}
          >
            {rule.user_muted ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onLock(rule.id, rule.user_locked)}
            title={rule.user_locked ? "Unlock rule" : "Lock rule"}
          >
            {rule.user_locked ? (
              <Unlock className="w-4 h-4" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(rule.id)}
            title="Delete rule"
          >
            <Trash2 className="w-4 h-4 text-destructive" />
          </Button>
        </div>
      </div>
    </div>
  );
}
