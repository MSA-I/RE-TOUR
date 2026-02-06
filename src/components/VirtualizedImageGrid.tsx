import React, { useCallback, useRef, useState, useEffect, memo } from "react";
import { Loader2 } from "lucide-react";

interface VirtualizedImageGridProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  getKey: (item: T) => string;
  pageSize?: number;
  className?: string;
  emptyMessage?: React.ReactNode;
  thumbnailSize?: number; // New prop for dynamic sizing
}

/**
 * Virtualized grid with pagination/infinite scroll
 * Only renders visible items + one page ahead
 */
function VirtualizedImageGridInner<T>({
  items,
  renderItem,
  getKey,
  pageSize = 24,
  className = "",
  emptyMessage = "No items",
  thumbnailSize
}: VirtualizedImageGridProps<T>) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const loaderRef = useRef<HTMLDivElement>(null);

  // Calculate grid columns based on thumbnail size
  const getGridStyle = (): React.CSSProperties => {
    if (!thumbnailSize) return {};
    
    // Use CSS grid with auto-fill to dynamically calculate columns
    return {
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))`,
      gap: '1rem'
    };
  };

  // Intersection observer for infinite scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && visibleCount < items.length) {
          setVisibleCount((prev) => Math.min(prev + pageSize, items.length));
        }
      },
      { rootMargin: "200px" }
    );

    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }

    return () => observer.disconnect();
  }, [visibleCount, items.length, pageSize]);

  // Reset visible count when items change significantly
  useEffect(() => {
    if (items.length < visibleCount - pageSize) {
      setVisibleCount(pageSize);
    }
  }, [items.length, visibleCount, pageSize]);

  if (items.length === 0) {
    return <div className="py-8 text-center text-muted-foreground">{emptyMessage}</div>;
  }

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  // Use custom grid style if thumbnailSize is provided, otherwise use default classes
  const gridClassName = thumbnailSize 
    ? "" 
    : "grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

  return (
    <div className={className}>
      <div className={gridClassName} style={getGridStyle()}>
        {visibleItems.map((item, index) => (
          <React.Fragment key={getKey(item)}>
            {renderItem(item, index)}
          </React.Fragment>
        ))}
      </div>
      
      {hasMore && (
        <div ref={loaderRef} className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export const VirtualizedImageGrid = memo(VirtualizedImageGridInner) as typeof VirtualizedImageGridInner;
