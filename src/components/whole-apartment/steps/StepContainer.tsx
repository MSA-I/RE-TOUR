import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2, Check, AlertCircle, Clock } from "lucide-react";
import { StepStatus } from "./types";

/**
 * Shared wrapper for step components
 *
 * Provides consistent layout, status indicators, and styling
 * for all pipeline steps.
 */

interface StepContainerProps {
  stepNumber: string;
  stepName: string;
  status: StepStatus;
  description?: string;
  children: ReactNode;
  className?: string;
}

const STATUS_CONFIG: Record<StepStatus, { icon: ReactNode; color: string; label: string }> = {
  pending: {
    icon: <Clock className="w-4 h-4" />,
    color: "bg-muted text-muted-foreground",
    label: "Pending"
  },
  running: {
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    color: "bg-blue-500/20 text-blue-400",
    label: "Running"
  },
  review: {
    icon: <Clock className="w-4 h-4" />,
    color: "bg-yellow-500/20 text-yellow-400",
    label: "Review"
  },
  approved: {
    icon: <Check className="w-4 h-4" />,
    color: "bg-green-500/20 text-green-400",
    label: "Approved"
  },
  completed: {
    icon: <Check className="w-4 h-4" />,
    color: "bg-primary/20 text-primary",
    label: "Complete"
  },
  failed: {
    icon: <AlertCircle className="w-4 h-4" />,
    color: "bg-destructive/20 text-destructive",
    label: "Failed"
  },
  blocked: {
    icon: <AlertCircle className="w-4 h-4" />,
    color: "bg-muted text-muted-foreground",
    label: "Blocked"
  }
};

export function StepContainer({
  stepNumber,
  stepName,
  status,
  description,
  children,
  className
}: StepContainerProps) {
  const config = STATUS_CONFIG[status];

  return (
    <Card
      className={cn("w-full", className)}
      role="region"
      aria-labelledby={`step-${stepNumber}-heading`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div
                className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm"
                aria-hidden="true"
              >
                {stepNumber}
              </div>
              <CardTitle
                id={`step-${stepNumber}-heading`}
                className="text-base"
              >
                {stepName}
              </CardTitle>
            </div>
          </div>

          <Badge
            variant="secondary"
            className={cn("gap-1.5", config.color)}
            role="status"
            aria-label={`Step status: ${config.label}`}
          >
            {config.icon}
            <span className="text-xs font-medium">{config.label}</span>
          </Badge>
        </div>

        {description && (
          <p
            className="text-sm text-muted-foreground mt-2"
            id={`step-${stepNumber}-description`}
          >
            {description}
          </p>
        )}
      </CardHeader>

      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}
