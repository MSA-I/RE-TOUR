import { useEffect, useRef, forwardRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Terminal, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useBatchProgress, BatchJobEvent } from "@/hooks/useBatchProgress";

interface BatchJobTerminalProps {
  batchJobId: string;
  isOpen: boolean;
}

export const BatchJobTerminal = forwardRef<HTMLDivElement, BatchJobTerminalProps>(
  function BatchJobTerminal({ batchJobId, isOpen }, ref) {
    const { events, isComplete } = useBatchProgress(isOpen ? batchJobId : null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new events arrive
    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [events]);

    if (!isOpen) return null;

    const getEventColor = (type: string) => {
      if (type.includes("fail") || type.includes("error")) return "text-red-400";
      if (type.includes("complete") || type.includes("pass")) return "text-green-400";
      if (type.includes("qa_fail") || type.includes("rejected")) return "text-yellow-400";
      if (type.includes("start") || type.includes("batch")) return "text-blue-400";
      if (type.includes("retry")) return "text-orange-400";
      return "text-muted-foreground";
    };

    const getEventBadge = (type: string): "destructive" | "secondary" | "default" | "outline" => {
      if (type.includes("fail") || type.includes("error")) return "destructive";
      if (type.includes("complete") || type.includes("pass")) return "default";
      if (type.includes("qa")) return "secondary";
      return "outline";
    };

    return (
      <div ref={ref} className="mt-3 rounded-lg border border-border/50 bg-black/90 font-mono text-xs overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-muted/20">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Batch Process Log</span>
          {!isComplete && events.length > 0 && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
          {isComplete && (
            <Badge variant="default" className="ml-auto text-[10px]">Complete</Badge>
          )}
        </div>

        {/* Terminal content */}
        <ScrollArea className="h-64" ref={scrollRef}>
          <div className="p-3 space-y-1">
            {events.length === 0 && (
              <div className="text-muted-foreground italic">Waiting for events...</div>
            )}
            {events.map((event) => (
              <div key={event.id} className="flex items-start gap-2">
                <span className="text-muted-foreground shrink-0 w-20">
                  {format(new Date(event.ts), "HH:mm:ss")}
                </span>
                <Badge variant={getEventBadge(event.type)} className="text-[10px] px-1 py-0 shrink-0 w-16 justify-center">
                  {event.progress_int}%
                </Badge>
                <span className={getEventColor(event.type)}>{event.message}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }
);
