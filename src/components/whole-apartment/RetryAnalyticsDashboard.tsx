import { useEffect, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TrendingDown, Activity, CheckCircle2, AlertCircle } from "lucide-react";

interface RetryAnalytics {
  avgRetryCount: number;
  totalPipelines: number;
  successRate: number;
  trendByDate: Array<{ date: string; avgRetries: number; count: number }>;
}

interface RetryAnalyticsDashboardProps {
  projectId?: string | null;
  stepId?: number | null;
}

/**
 * Dashboard showing QA retry analytics over time.
 * Demonstrates learning effectiveness as retry count trends toward 0.
 */
export function RetryAnalyticsDashboard({ projectId, stepId }: RetryAnalyticsDashboardProps) {
  const supabase = useSupabaseClient();
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const [analytics, setAnalytics] = useState<RetryAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: fetchError } = await supabase.functions.invoke(
          "get-retry-analytics",
          {
            body: { projectId, stepId, timeRange },
          }
        );

        if (fetchError) {
          throw fetchError;
        }

        setAnalytics(data as RetryAnalytics);
      } catch (err) {
        console.error("[RetryAnalyticsDashboard] Error:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch analytics");
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [projectId, stepId, timeRange, supabase]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 animate-pulse" />
            Learning Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading analytics...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-destructive" />
            Learning Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!analytics) {
    return null;
  }

  // Calculate trend direction (comparing first half vs second half of data)
  const halfPoint = Math.floor(analytics.trendByDate.length / 2);
  const firstHalfAvg =
    analytics.trendByDate.slice(0, halfPoint).reduce((sum, d) => sum + d.avgRetries, 0) /
    (halfPoint || 1);
  const secondHalfAvg =
    analytics.trendByDate.slice(halfPoint).reduce((sum, d) => sum + d.avgRetries, 0) /
    (analytics.trendByDate.length - halfPoint || 1);
  const isImproving = secondHalfAvg < firstHalfAvg;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          QA Learning Analytics
        </CardTitle>
        <CardDescription>
          Tracking how the AI learns to avoid QA failures over time
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Time Range Selector */}
        <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
            <TabsTrigger value="90d">90 Days</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Key Metrics */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Avg Retry Count</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{analytics.avgRetryCount.toFixed(2)}</p>
              {isImproving && (
                <TrendingDown className="w-4 h-4 text-green-500" />
              )}
            </div>
            {isImproving && (
              <Badge variant="outline" className="text-xs border-green-500/50 text-green-500">
                Improving
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Total Tasks</p>
            <p className="text-2xl font-bold">{analytics.totalPipelines}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Success Rate</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{analytics.successRate.toFixed(1)}%</p>
              {analytics.successRate >= 80 && (
                <CheckCircle2 className="w-4 h-4 text-green-500" />
              )}
            </div>
          </div>
        </div>

        {/* Trend Visualization (Simple ASCII-style chart) */}
        {analytics.trendByDate.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Retry Trend</p>
            <div className="space-y-1 font-mono text-xs">
              {analytics.trendByDate.map((point, i) => {
                const barWidth = Math.min((point.avgRetries / 5) * 100, 100); // Max 5 retries
                const isRecent = i >= analytics.trendByDate.length - 3;
                return (
                  <div key={point.date} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-24">
                      {new Date(point.date).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <div className="flex-1 bg-muted rounded-sm h-4 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          isRecent ? "bg-blue-500" : "bg-muted-foreground/30"
                        }`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground w-12 text-right">
                      {point.avgRetries.toFixed(1)}
                    </span>
                    <Badge variant="outline" className="text-xs w-12 justify-center">
                      {point.count}
                    </Badge>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {isImproving
                ? "✓ Average retry count is decreasing - learning is working!"
                : "Monitor this trend to see learning effectiveness over time."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
