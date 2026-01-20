import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { 
  Bell, Check, CheckCheck, Loader2, Play, CheckCircle, 
  XCircle, AlertTriangle, Clock, Eye, Trash2
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNotifications } from "@/hooks/useNotifications";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const typeIcons: Record<string, React.ReactNode> = {
  render_started: <Play className="h-4 w-4" />,
  render_completed: <CheckCircle className="h-4 w-4" />,
  render_failed: <XCircle className="h-4 w-4" />,
  qa_approved: <CheckCircle className="h-4 w-4" />,
  qa_rejected: <AlertTriangle className="h-4 w-4" />,
  progress: <Clock className="h-4 w-4" />,
  batch_started: <Play className="h-4 w-4" />,
  batch_completed: <CheckCircle className="h-4 w-4" />,
  batch_failed: <XCircle className="h-4 w-4" />,
  pipeline_started: <Play className="h-4 w-4" />,
  pipeline_step_complete: <CheckCircle className="h-4 w-4" />,
  pipeline_rejected: <XCircle className="h-4 w-4" />,
  pipeline_failed: <XCircle className="h-4 w-4" />,
  pipeline_attached: <CheckCircle className="h-4 w-4" />,
  edit_started: <Play className="h-4 w-4" />,
  edit_completed: <CheckCircle className="h-4 w-4" />,
  edit_failed: <XCircle className="h-4 w-4" />,
  error: <XCircle className="h-4 w-4" />
};

const typeStyles: Record<string, { icon: string; bg: string }> = {
  render_started: { icon: "text-blue-500", bg: "bg-blue-500/10" },
  render_completed: { icon: "text-green-500", bg: "bg-green-500/10" },
  render_failed: { icon: "text-red-500", bg: "bg-red-500/10" },
  qa_approved: { icon: "text-green-500", bg: "bg-green-500/10" },
  qa_rejected: { icon: "text-amber-500", bg: "bg-amber-500/10" },
  progress: { icon: "text-muted-foreground", bg: "bg-muted" },
  batch_started: { icon: "text-blue-500", bg: "bg-blue-500/10" },
  batch_completed: { icon: "text-green-500", bg: "bg-green-500/10" },
  batch_failed: { icon: "text-red-500", bg: "bg-red-500/10" },
  pipeline_started: { icon: "text-blue-500", bg: "bg-blue-500/10" },
  pipeline_step_complete: { icon: "text-green-500", bg: "bg-green-500/10" },
  pipeline_rejected: { icon: "text-red-500", bg: "bg-red-500/10" },
  pipeline_failed: { icon: "text-red-500", bg: "bg-red-500/10" },
  pipeline_attached: { icon: "text-primary", bg: "bg-primary/10" },
  edit_started: { icon: "text-blue-500", bg: "bg-blue-500/10" },
  edit_completed: { icon: "text-green-500", bg: "bg-green-500/10" },
  edit_failed: { icon: "text-red-500", bg: "bg-red-500/10" },
  error: { icon: "text-red-500", bg: "bg-red-500/10" }
};

const typeLabels: Record<string, string> = {
  render_started: "Render Started",
  render_completed: "Render Complete",
  render_failed: "Render Failed",
  qa_approved: "QA Approved",
  qa_rejected: "QA Rejected",
  progress: "In Progress",
  batch_started: "Batch Started",
  batch_completed: "Batch Complete",
  batch_failed: "Batch Failed",
  pipeline_started: "Pipeline Started",
  pipeline_step_complete: "Pipeline Step Complete",
  pipeline_rejected: "Pipeline Step Rejected",
  pipeline_failed: "Pipeline Failed",
  pipeline_attached: "Attached to Panoramas",
  edit_started: "Edit Started",
  edit_completed: "Edit Complete",
  edit_failed: "Edit Failed",
  error: "Error"
};

export function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead, clearAllNotifications } = useNotifications();
  const [open, setOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const handleNotificationClick = (notification: typeof notifications[0]) => {
    if (!notification.is_read) {
      markAsRead.mutate(notification.id);
    }
    
    if (notification.target_route) {
      const params = notification.target_params as Record<string, string> | null;
      let route = notification.target_route;
      
      // Build query string from params
      if (params && Object.keys(params).length > 0) {
        const queryString = new URLSearchParams(params).toString();
        route = `${route}?${queryString}`;
      }
      
      // Add autoOpen flag for completed notifications to trigger review panel
      const isCompletedNotification = notification.type === "render_completed" || notification.type === "batch_completed";
      if (isCompletedNotification && params?.jobId) {
        const separator = route.includes('?') ? '&' : '?';
        route = `${route}${separator}autoOpenReview=true`;
      }
      
      setOpen(false);
      navigate(route);
      
      // After navigation, scroll to the target element
      setTimeout(() => {
        const targetId = params?.jobId || params?.batchId || params?.uploadId;
        if (targetId) {
          const element = document.getElementById(`job-row-${targetId}`) || 
                          document.getElementById(`batch-row-${targetId}`) ||
                          document.getElementById(`upload-${targetId}`);
          if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            element.classList.add("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
            setTimeout(() => {
              element.classList.remove("ring-2", "ring-primary", "ring-offset-2", "ring-offset-background");
            }, 3000);
          }
        }
      }, 300);
    }
  };

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="relative p-2 hover:bg-muted rounded-lg transition-colors">
            <Bell className="h-5 w-5 text-muted-foreground" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1 leading-none animate-in zoom-in-50">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent 
          align="end" 
          alignOffset={-8}
          sideOffset={4}
          className="w-96 p-0 shadow-xl border border-border/80 rounded-lg overflow-hidden"
        >
          {/* Arrow pointing to bell - positioned precisely */}
          <div 
            className="absolute -top-[6px] right-[18px] w-3 h-3 rotate-45 bg-popover border-l border-t border-border/80"
            style={{ zIndex: 1 }}
          />
          
          {/* Header */}
          <div className="relative z-10 flex items-center justify-between px-4 py-3 border-b bg-muted/40">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  ({unreadCount} unread)
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs hover:bg-muted"
                  onClick={() => markAllAsRead.mutate()}
                  disabled={markAllAsRead.isPending}
                >
                  {markAllAsRead.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <CheckCheck className="h-3 w-3 mr-1" />
                      Mark all read
                    </>
                  )}
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={clearAllNotifications.isPending}
                >
                  {clearAllNotifications.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Content - ensure scrolling works */}
          <div className="max-h-[400px] overflow-y-auto overscroll-contain">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Bell className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {notifications.map((notification) => {
                  const styles = typeStyles[notification.type] || typeStyles.progress;
                  const icon = typeIcons[notification.type] || <Bell className="h-4 w-4" />;
                  const isClickable = !!notification.target_route;
                  const isCompleted = notification.type === "render_completed" || notification.type === "batch_completed";
                  
                  return (
                    <button
                      key={notification.id}
                      onClick={() => handleNotificationClick(notification)}
                      className={cn(
                        "w-full text-left px-4 py-3 transition-colors flex items-start gap-3",
                        isClickable && "hover:bg-muted/50 cursor-pointer",
                        !notification.is_read && "bg-accent/20"
                      )}
                    >
                      {/* Icon */}
                      <div className={cn(
                        "flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center mt-0.5",
                        styles.bg
                      )}>
                        <span className={styles.icon}>{icon}</span>
                      </div>
                      
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {typeLabels[notification.type] || notification.title}
                          </span>
                          {!notification.is_read && (
                            <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                        {notification.message && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                            {notification.message}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] text-muted-foreground/70">
                            {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                          </span>
                          {isCompleted && isClickable && (
                            <span className="text-[10px] text-primary/80 flex items-center gap-0.5">
                              <Eye className="h-3 w-3" />
                              View result
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Read indicator */}
                      {notification.is_read && (
                        <Check className="h-3 w-3 text-muted-foreground/50 flex-shrink-0 mt-1" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Clear History Confirmation Dialog */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Notification History?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all your notifications. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                clearAllNotifications.mutate();
                setClearConfirmOpen(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
