import { useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

interface Job {
  id: string;
  status: string;
  panorama?: { original_filename?: string };
  progress_message?: string;
}

export function useJobNotifications(jobs: Job[]) {
  const { toast } = useToast();
  const previousJobsRef = useRef<Map<string, string>>(new Map());
  const notificationPermissionRef = useRef<NotificationPermission>("default");

  // Request notification permission on mount
  useEffect(() => {
    if ("Notification" in window) {
      notificationPermissionRef.current = Notification.permission;
      
      if (Notification.permission === "default") {
        // Request permission when user first interacts
        const requestPermission = async () => {
          const permission = await Notification.requestPermission();
          notificationPermissionRef.current = permission;
        };
        
        // Delay permission request slightly
        const timer = setTimeout(requestPermission, 5000);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  // Send browser notification
  const sendBrowserNotification = useCallback((title: string, body: string, tag?: string) => {
    if ("Notification" in window && notificationPermissionRef.current === "granted") {
      try {
        const notification = new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: tag || "render-job",
          requireInteraction: false,
        });

        // Auto-close after 5 seconds
        setTimeout(() => notification.close(), 5000);

        // Focus window when clicked
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch (error) {
        console.warn("Failed to send browser notification:", error);
      }
    }
  }, []);

  // Track job status changes and notify on completion
  useEffect(() => {
    const previousJobs = previousJobsRef.current;
    
    jobs.forEach((job) => {
      const previousStatus = previousJobs.get(job.id);
      const currentStatus = job.status;
      
      // Only notify if status changed from running to a final state
      if (previousStatus === "running" && previousStatus !== currentStatus) {
        const jobName = job.panorama?.original_filename || "Render job";
        
        if (currentStatus === "needs_review") {
          // Success - ready for review
          toast({
            title: "Render Complete! 🎉",
            description: `${jobName} is ready for review.`,
          });
          sendBrowserNotification(
            "Render Complete!",
            `${jobName} is ready for review.`,
            `job-${job.id}`
          );
        } else if (currentStatus === "approved") {
          toast({
            title: "Render Approved ✓",
            description: `${jobName} passed QA and is approved.`,
          });
          sendBrowserNotification(
            "Render Approved!",
            `${jobName} passed QA and is approved.`,
            `job-${job.id}`
          );
        } else if (currentStatus === "rejected") {
          toast({
            title: "QA Review Required",
            description: `${jobName} needs attention. ${job.progress_message || ""}`,
            variant: "destructive",
          });
          sendBrowserNotification(
            "QA Review Required",
            `${jobName} needs attention.`,
            `job-${job.id}`
          );
        } else if (currentStatus === "failed") {
          toast({
            title: "Render Failed",
            description: `${jobName} failed. Check the error details.`,
            variant: "destructive",
          });
          sendBrowserNotification(
            "Render Failed",
            `${jobName} failed. Check the error details.`,
            `job-${job.id}`
          );
        }
      }
      
      // Update tracking map
      previousJobs.set(job.id, currentStatus);
    });
    
    // Clean up jobs that no longer exist
    const currentJobIds = new Set(jobs.map(j => j.id));
    for (const [id] of previousJobs) {
      if (!currentJobIds.has(id)) {
        previousJobs.delete(id);
      }
    }
  }, [jobs, toast, sendBrowserNotification]);

  // Request notification permission manually
  const requestNotificationPermission = useCallback(async () => {
    if ("Notification" in window && Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      notificationPermissionRef.current = permission;
      return permission;
    }
    return notificationPermissionRef.current;
  }, []);

  return {
    notificationPermission: notificationPermissionRef.current,
    requestNotificationPermission,
  };
}
