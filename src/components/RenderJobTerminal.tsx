import { useEffect, useRef, useState, forwardRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Terminal, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface LogEntry {
  id: string;
  created_at: string;
  level: string;
  message: string;
}

interface RenderJobTerminalProps {
  jobId: string;
  isOpen: boolean;
}

export const RenderJobTerminal = forwardRef<HTMLDivElement, RenderJobTerminalProps>(
  function RenderJobTerminal({ jobId, isOpen }, ref) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Fetch existing logs and subscribe to new ones
    useEffect(() => {
      if (!isOpen || !jobId) return;

      setIsLoading(true);
      setLogs([]); // Clear logs when switching jobs

      // Fetch existing logs
      const fetchLogs = async () => {
        const { data, error } = await supabase
          .from("render_job_logs")
          .select("*")
          .eq("job_id", jobId)
          .order("created_at", { ascending: true });

        if (!error && data) {
          setLogs(data as LogEntry[]);
        }
        setIsLoading(false);
      };

      fetchLogs();

      // Subscribe to new logs
      const channel = supabase
        .channel(`job-logs-${jobId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "render_job_logs",
            filter: `job_id=eq.${jobId}`,
          },
          (payload) => {
            const newLog = payload.new as LogEntry;
            setLogs((prev) => [...prev, newLog]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [jobId, isOpen]);

    // Auto-scroll to bottom when new logs arrive
    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [logs]);

    if (!isOpen) return null;

    const getLevelColor = (level: string) => {
      switch (level) {
        case "error":
          return "text-red-400";
        case "warn":
          return "text-yellow-400";
        case "success":
          return "text-green-400";
        case "debug":
          return "text-gray-500";
        default:
          return "text-blue-300";
      }
    };

    const getLevelBadge = (level: string): "destructive" | "secondary" | "default" | "outline" => {
      switch (level) {
        case "error":
          return "destructive";
        case "warn":
          return "secondary";
        case "success":
          return "default";
        default:
          return "outline";
      }
    };

    return (
      <div ref={ref} className="mt-3 rounded-lg border border-border/50 bg-black/90 font-mono text-xs overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Process Log</span>
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />}
        </div>

        {/* Terminal content */}
        <ScrollArea className="h-48" ref={scrollRef}>
          <div className="p-3 space-y-1">
            {logs.length === 0 && !isLoading && (
              <div className="text-muted-foreground italic">Waiting for logs...</div>
            )}
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2">
                <span className="text-muted-foreground shrink-0">
                  {format(new Date(log.created_at), "HH:mm:ss.SSS")}
                </span>
                <Badge variant={getLevelBadge(log.level)} className="text-[10px] px-1 py-0 shrink-0">
                  {log.level.toUpperCase()}
                </Badge>
                <span className={getLevelColor(log.level)}>{log.message}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }
);
