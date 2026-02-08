import { useEffect, useRef, forwardRef } from "react";
import { useMultiImagePanoramaEvents } from "@/hooks/useMultiImagePanoramaJobs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Terminal, Loader2 } from "lucide-react";
import { format } from "date-fns";

interface MultiImagePanoramaTerminalProps {
  jobId: string;
  isOpen: boolean;
}

export const MultiImagePanoramaTerminal = forwardRef<HTMLDivElement, MultiImagePanoramaTerminalProps>(
  function MultiImagePanoramaTerminal({ jobId, isOpen }, ref) {
    const events = useMultiImagePanoramaEvents(isOpen ? jobId : null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new events arrive
    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [events]);

    if (!isOpen) return null;

    const getTypeColor = (type: string) => {
      switch (type) {
        case "error":
          return "text-red-400";
        case "warn":
        case "warning":
          return "text-yellow-400";
        case "success":
        case "complete":
          return "text-green-400";
        case "debug":
          return "text-gray-500";
        default:
          return "text-blue-300";
      }
    };

    const getTypeBadge = (type: string): "destructive" | "secondary" | "default" | "outline" => {
      switch (type) {
        case "error":
          return "destructive";
        case "warn":
        case "warning":
          return "secondary";
        case "success":
        case "complete":
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
          {events.length === 0 && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-auto" />
          )}
        </div>

        {/* Terminal content */}
        <ScrollArea className="h-48" ref={scrollRef}>
          <div className="p-3 space-y-1">
            {events.length === 0 && (
              <div className="text-muted-foreground italic">Waiting for logs...</div>
            )}
            {events.map((event) => (
              <div key={event.id} className="flex items-start gap-2">
                <span className="text-muted-foreground shrink-0">
                  {format(new Date(event.ts), "HH:mm:ss.SSS")}
                </span>
                <Badge variant={getTypeBadge(event.type)} className="text-[10px] px-1 py-0 shrink-0">
                  {event.type.toUpperCase()}
                </Badge>
                <span className={getTypeColor(event.type)}>{event.message}</span>
                {event.progress_int !== null && event.progress_int > 0 && (
                  <span className="text-muted-foreground ml-auto">[{event.progress_int}%]</span>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }
);
