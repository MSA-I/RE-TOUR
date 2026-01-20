import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function FatalErrorFallback(props: { title?: string; message?: string }) {
  const title = props.title ?? "Something went wrong";
  const message =
    props.message ??
    "The app hit a fatal error and couldn't render. Please reload the page.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <div className="p-4 rounded-full bg-destructive/10">
            <AlertTriangle className="h-12 w-12 text-destructive" />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <p className="text-muted-foreground">{message}</p>
        </div>

        <div className="flex gap-3 justify-center">
          <Button
            onClick={() => window.location.reload()}
            className="min-w-40"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}
