import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface JobEvent {
  id: string;
  job_id: string;
  owner_id: string;
  ts: string;
  type: string;
  message: string;
  progress_int: number;
}

export function useJobProgress(jobId: string | null) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [progress, setProgress] = useState(0);
  const [latestMessage, setLatestMessage] = useState<string>("");
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setEvents([]);
      setProgress(0);
      setLatestMessage("");
      setIsComplete(false);
      return;
    }

    // Fetch existing events
    const fetchEvents = async () => {
      const { data, error } = await supabase
        .from("render_job_events")
        .select("*")
        .eq("job_id", jobId)
        .order("ts", { ascending: true });

      if (error) {
        console.error("Error fetching job events:", error);
        return;
      }

      if (data && data.length > 0) {
        setEvents(data as JobEvent[]);
        const latest = data[data.length - 1] as JobEvent;
        setProgress(latest.progress_int);
        setLatestMessage(latest.message);
        if (latest.progress_int >= 100 || latest.type === "done") {
          setIsComplete(true);
        }
      }
    };

    fetchEvents();

    // Subscribe to new events
    const channel = supabase
      .channel(`job_events_${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "render_job_events",
          filter: `job_id=eq.${jobId}`,
        },
        (payload) => {
          const newEvent = payload.new as JobEvent;
          setEvents((prev) => [...prev, newEvent]);
          setProgress(newEvent.progress_int);
          setLatestMessage(newEvent.message);
          if (newEvent.progress_int >= 100 || newEvent.type === "done") {
            setIsComplete(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId]);

  return { events, progress, latestMessage, isComplete };
}
