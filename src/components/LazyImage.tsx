import React, { memo, useState, useCallback, useEffect, useRef } from "react";
import { Loader2, ImageOff } from "lucide-react";

interface LazyImageProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  onClick?: () => void;
  fallback?: React.ReactNode;
  onLoad?: () => void;
  onError?: () => void;
}

/**
 * Lazy-loaded image with loading state and error handling
 * Uses native lazy loading + decoding async
 */
export const LazyImage = memo(function LazyImage({
  src,
  alt,
  className = "",
  onClick,
  fallback,
  onLoad,
  onError
}: LazyImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    src ? "loading" : "error"
  );
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset status when src changes
  useEffect(() => {
    if (src) {
      setStatus("loading");
    } else {
      setStatus("error");
    }
  }, [src]);

  const handleLoad = useCallback(() => {
    setStatus("loaded");
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setStatus("error");
    onError?.();
  }, [onError]);

  if (!src) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        {fallback || <ImageOff className="h-6 w-6 text-muted-foreground" />}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} onClick={onClick}>
      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          {fallback || <ImageOff className="h-6 w-6 text-muted-foreground" />}
        </div>
      )}
      
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          status === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
});
