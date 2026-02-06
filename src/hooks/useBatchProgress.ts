import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BatchJobEvent {
  id: string;
  batch_job_id: string;
  item_id: string | null;
  owner_id: string;
  ts: string;
  type: string;
  message: string;
  progress_int: number;
}

export function useBatchProgress(batchJobId: string | null) {
  const [events, setEvents] = useState<BatchJobEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [latestMessage, setLatestMessage] = useState<string>("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!batchJobId) {
      setEvents([]);
      setProgress(0);
      setLatestMessage("");
      setIsComplete(false);
      return;
    }

    // Fetch existing events
    const fetchEvents = async () => {
      const { data, error } = await supabase
        .from("batch_job_events")
        .select("*")
        .eq("batch_job_id", batchJobId)
        .order("ts", { ascending: true });

      if (error) {
        console.error("Error fetching batch events:", error);
        return;
      }

      if (data && data.length > 0) {
        setEvents(data as BatchJobEvent[]);
        const latest = data[data.length - 1] as BatchJobEvent;
        setProgress(latest.progress_int);
        setLatestMessage(latest.message);
        if (latest.progress_int >= 100 || latest.type === "batch_complete") {
          setIsComplete(true);
        }
      }
    };

    fetchEvents();

    // Subscribe to new events
    const channel = supabase
      .channel(`batch_events_${batchJobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "batch_job_events",
          filter: `batch_job_id=eq.${batchJobId}`,
        },
        (payload) => {
          const newEvent = payload.new as BatchJobEvent;
          setEvents((prev) => [...prev, newEvent]);
          setProgress(newEvent.progress_int);
          setLatestMessage(newEvent.message);
          if (newEvent.progress_int >= 100 || newEvent.type === "batch_complete") {
            setIsComplete(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [batchJobId]);

  return { events, progress, latestMessage, isComplete };
}
