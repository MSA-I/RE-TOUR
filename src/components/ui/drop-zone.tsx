import React, { useState, useCallback, useRef, createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "./button";

// Context to pass click handler to nested DropZone.Button components
interface DropZoneContextValue {
  triggerFileSelect: () => void;
  isUploading: boolean;
  isDisabled: boolean;
}

const DropZoneContext = createContext<DropZoneContextValue | null>(null);

interface DropZoneProps {
  onFilesDropped: (files: FileList) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  isUploading?: boolean;
  maxFiles?: number;
  currentCount?: number;
  className?: string;
  buttonLabel?: string;
  dropLabel?: string;
  children?: React.ReactNode;
}

export function DropZone({
  onFilesDropped,
  accept = "image/*",
  multiple = true,
  disabled = false,
  isUploading = false,
  maxFiles,
  currentCount = 0,
  className,
  buttonLabel = "Upload",
  dropLabel = "Drop images here or click to upload",
  children,
}: DropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDisabled = disabled || isUploading || (maxFiles !== undefined && currentCount >= maxFiles);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDisabled) {
      setIsDragOver(true);
    }
  }, [isDisabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (isDisabled) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      // Filter files by accept type if specified
      const acceptedFiles = filterFilesByAccept(files, accept);
      if (acceptedFiles.length > 0) {
        onFilesDropped(acceptedFiles as unknown as FileList);
      }
    }
  }, [isDisabled, accept, onFilesDropped]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFilesDropped(files);
    }
    // Reset input value to allow selecting the same file again
    e.target.value = "";
  }, [onFilesDropped]);

  const triggerFileSelect = useCallback(() => {
    if (!isDisabled) {
      fileInputRef.current?.click();
    }
  }, [isDisabled]);

  const contextValue: DropZoneContextValue = {
    triggerFileSelect,
    isUploading,
    isDisabled,
  };

  return (
    <DropZoneContext.Provider value={contextValue}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative transition-all duration-200",
          isDragOver && !isDisabled && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          className
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleFileSelect}
          className="hidden"
          disabled={isDisabled}
        />
        
        {children ? (
          // Render children - DropZone.Button will use context to get click handler
          <div>{children}</div>
        ) : (
          // Default drop zone UI
          <div
            onClick={triggerFileSelect}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
              isDragOver && !isDisabled ? "border-primary bg-primary/5" : "border-muted-foreground/25",
              isDisabled ? "opacity-50 cursor-not-allowed" : "hover:border-muted-foreground/50",
            )}
          >
            <div className="flex flex-col items-center gap-2">
              {isUploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="h-8 w-8 text-muted-foreground" />
              )}
              <p className="text-sm text-muted-foreground">{dropLabel}</p>
              {maxFiles !== undefined && (
                <p className="text-xs text-muted-foreground">
                  {currentCount}/{maxFiles} uploaded
                </p>
              )}
            </div>
          </div>
        )}

        {/* Drag overlay for custom children */}
        {children && isDragOver && !isDisabled && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none z-10">
            <div className="bg-background/95 px-4 py-2 rounded-md shadow-lg">
              <p className="text-sm font-medium text-primary">Drop files to upload</p>
            </div>
          </div>
        )}
      </div>
    </DropZoneContext.Provider>
  );
}

// Helper to filter files by accept attribute
function filterFilesByAccept(files: FileList, accept: string): File[] {
  if (!accept || accept === "*") return Array.from(files);
  
  const acceptTypes = accept.split(",").map(t => t.trim().toLowerCase());
  
  return Array.from(files).filter(file => {
    const fileType = file.type.toLowerCase();
    const fileName = file.name.toLowerCase();
    const fileExt = "." + fileName.split(".").pop();
    
    return acceptTypes.some(acceptType => {
      if (acceptType.startsWith(".")) {
        // Extension match
        return fileExt === acceptType;
      } else if (acceptType.endsWith("/*")) {
        // Wildcard match (e.g., image/*)
        const baseType = acceptType.slice(0, -2);
        return fileType.startsWith(baseType);
      } else {
        // Exact MIME type match
        return fileType === acceptType;
      }
    });
  });
}

// Sub-component for the upload button - uses context to get click handler
interface DropZoneButtonProps {
  onClick?: () => void;
  isUploading?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export function DropZoneButton({
  onClick,
  isUploading: isUploadingProp,
  disabled: disabledProp,
  children = "Upload",
  className,
  variant = "default",
  size = "default",
}: DropZoneButtonProps) {
  const context = useContext(DropZoneContext);
  
  // Use context values if available, otherwise fall back to props
  const handleClick = context?.triggerFileSelect ?? onClick;
  const isUploading = context?.isUploading ?? isUploadingProp ?? false;
  const isDisabled = context?.isDisabled ?? disabledProp ?? false;

  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      variant={variant}
      size={size}
      className={className}
    >
      {isUploading ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Upload className="h-4 w-4 mr-2" />
      )}
      {children}
    </Button>
  );
}

DropZone.Button = DropZoneButton;
