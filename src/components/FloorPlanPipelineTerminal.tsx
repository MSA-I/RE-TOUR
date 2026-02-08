import { useEffect, useRef, useState, forwardRef, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Terminal, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface PipelineEvent {
  id: string;
  pipeline_id: string;
  step_number: number;
  ts: string;
  type: string;
  message: string;
  progress_int: number;
}

interface FloorPlanPipelineTerminalProps {
  pipelineId: string;
  isOpen: boolean;
  stepFilter?: number | null;
  /** Current step name for display (e.g., "Space Analysis", "Top-Down 3D") */
  currentStepName?: string;
  /** Whether the pipeline is currently running */
  isLive?: boolean;
}

const FloorPlanPipelineTerminalInner = forwardRef<HTMLDivElement, FloorPlanPipelineTerminalProps>(
  function FloorPlanPipelineTerminalInner({ pipelineId, isOpen, stepFilter, currentStepName, isLive }, ref) {
    const [events, setEvents] = useState<PipelineEvent[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Fetch existing events and subscribe to new ones
    useEffect(() => {
      if (!isOpen || !pipelineId) return;

      setIsLoading(true);
      setEvents([]);

      // Fetch existing events
      const fetchEvents = async () => {
        const { data, error } = await supabase
          .from("floorplan_pipeline_events")
          .select("*")
          .eq("pipeline_id", pipelineId)
          .order("ts", { ascending: true });

        if (!error && data) {
          setEvents(data as PipelineEvent[]);
        }
        setIsLoading(false);
      };

      fetchEvents();

      // Subscribe to new events
      const channel = supabase
        .channel(`pipeline-events-${pipelineId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "floorplan_pipeline_events",
            filter: `pipeline_id=eq.${pipelineId}`,
          },
          (payload) => {
            const newEvent = payload.new as PipelineEvent;
            setEvents((prev) => [...prev, newEvent]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [pipelineId, isOpen]);

    // Auto-scroll to bottom when new events arrive
    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [events]);

    if (!isOpen) return null;

    const getTypeColor = (type: string) => {
      if (type.includes("error") || type.includes("failed")) return "text-red-400";
      if (type.includes("complete") || type.includes("success")) return "text-green-400";
      if (type.includes("start") || type.includes("running")) return "text-blue-400";
      if (type.includes("qa")) return "text-yellow-400";
      if (type.includes("upload") || type.includes("download")) return "text-purple-400";
      if (type.includes("api")) return "text-cyan-400";
      return "text-muted-foreground";
    };

    const getTypeBadge = (type: string): "destructive" | "secondary" | "default" | "outline" => {
      if (type.includes("error") || type.includes("failed")) return "destructive";
      if (type.includes("complete") || type.includes("success")) return "default";
      if (type.includes("qa")) return "secondary";
      return "outline";
    };

    const filteredEvents = stepFilter
      ? events.filter((e) => e.step_number === stepFilter)
      : events;

    return (
      <div ref={ref} className="mt-3 rounded-lg border border-border/50 bg-black/90 font-mono text-xs overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/20">
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-primary" />
            <span className="text-muted-foreground">
              Pipeline Log {stepFilter ? `(Step ${stepFilter})` : "(All Steps)"}
            </span>
            {isLive && (
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Live
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentStepName && isLive && (
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
                {currentStepName}
              </Badge>
            )}
            {isLoading && !isLive && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {/* Terminal content */}
        <ScrollArea className="h-48" ref={scrollRef}>
          <div className="p-3 space-y-1">
            {filteredEvents.length === 0 && !isLoading && (
              <div className="text-muted-foreground italic">Waiting for pipeline events...</div>
            )}
            {filteredEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-2">
                <span className="text-muted-foreground shrink-0">
                  {format(new Date(event.ts), "HH:mm:ss")}
                </span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0 bg-muted/30">
                  S{event.step_number}
                </Badge>
                <Badge variant={getTypeBadge(event.type)} className="text-[10px] px-1 py-0 shrink-0">
                  {event.type.replace(/_/g, " ").toUpperCase()}
                </Badge>
                <span className={getTypeColor(event.type)}>{event.message}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }
);

export const FloorPlanPipelineTerminal = memo(FloorPlanPipelineTerminalInner);
