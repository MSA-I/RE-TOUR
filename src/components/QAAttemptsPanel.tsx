import { useState } from "react";
import { useJobAttempts, JobAttempt } from "@/hooks/useJobAttempts";
import { useStorage } from "@/hooks/useStorage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, ChevronDown, ChevronUp, Check, X, AlertCircle, Eye } from "lucide-react";
import { format } from "date-fns";

interface QAAttemptsPanelProps {
  jobId: string;
  onViewOutput?: (bucket: string, path: string) => void;
}

export function QAAttemptsPanel({ jobId, onViewOutput }: QAAttemptsPanelProps) {
  const { attempts, isLoading } = useJobAttempts(jobId);
  const [isOpen, setIsOpen] = useState(false);
  const [loadingOutputs, setLoadingOutputs] = useState<Set<string>>(new Set());
  const { getSignedViewUrl } = useStorage();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading attempts...
      </div>
    );
  }

  if (attempts.length === 0) {
    return null;
  }

  const latestAttempt = attempts[attempts.length - 1];
  const hasRejections = attempts.some(a => a.qa_decision === 'rejected');
  const allFailed = attempts.length > 0 && attempts.every(a => a.qa_decision === 'rejected');

  const handleViewOutput = async (attempt: JobAttempt) => {
    if (!attempt.output || !onViewOutput) return;
    
    setLoadingOutputs(prev => new Set(prev).add(attempt.id));
    try {
      onViewOutput(attempt.output.bucket, attempt.output.path);
    } finally {
      setLoadingOutputs(prev => {
        const next = new Set(prev);
        next.delete(attempt.id);
        return next;
      });
    }
  };

  const getStatusBadge = (decision: string | null) => {
    switch (decision) {
      case 'approved':
        return <Badge className="bg-green-500/20 text-green-400"><Check className="h-3 w-3 mr-1" />Approved</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/20 text-red-400"><X className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge className="bg-yellow-500/20 text-yellow-400"><AlertCircle className="h-3 w-3 mr-1" />Pending</Badge>;
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span>QA Attempts</span>
                <Badge variant="outline" className="text-xs">
                  {attempts.length} attempt{attempts.length !== 1 ? 's' : ''}
                </Badge>
                {hasRejections && !allFailed && (
                  <Badge className="bg-yellow-500/20 text-yellow-400 text-xs">
                    Had rejections
                  </Badge>
                )}
                {allFailed && (
                  <Badge className="bg-red-500/20 text-red-400 text-xs">
                    Auto-fix exhausted
                  </Badge>
                )}
              </div>
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {attempts.map((attempt, index) => (
              <div 
                key={attempt.id} 
                className={`p-3 rounded-lg border ${
                  index === attempts.length - 1 
                    ? 'bg-primary/5 border-primary/20' 
                    : 'bg-muted/30 border-border/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">
                        Attempt #{attempt.attempt_number}
                      </span>
                      {getStatusBadge(attempt.qa_decision)}
                      {index === attempts.length - 1 && (
                        <Badge variant="secondary" className="text-xs">Current</Badge>
                      )}
                    </div>
                    {attempt.qa_reason && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {attempt.qa_reason}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(attempt.created_at), "MMM d, HH:mm:ss")}
                    </p>
                  </div>
                  
                  {attempt.output && onViewOutput && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleViewOutput(attempt)}
                      disabled={loadingOutputs.has(attempt.id)}
                    >
                      {loadingOutputs.has(attempt.id) ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}