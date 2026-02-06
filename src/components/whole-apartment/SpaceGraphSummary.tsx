import React from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Network, 
  Home, 
  ArrowRight,
  Lock,
  Eye,
  AlertCircle,
  CheckCircle2,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  SpatialMap, 
  getRoomId, 
  getRoomDisplayName,
  DetectedRoom,
  RoomAdjacency 
} from "@/hooks/useSpatialMap";

interface SpaceGraphSummaryProps {
  spatialMap: SpatialMap | null;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

// Build adjacency list for display
function buildAdjacencyList(
  rooms: DetectedRoom[], 
  edges: RoomAdjacency[]
): Map<string, { room: DetectedRoom; connections: Array<{ target: DetectedRoom; type: string }> }> {
  const roomMap = new Map<string, DetectedRoom>();
  rooms.forEach(r => roomMap.set(getRoomId(r), r));

  const adjacencyList = new Map<string, { room: DetectedRoom; connections: Array<{ target: DetectedRoom; type: string }> }>();
  
  // Initialize all rooms
  rooms.forEach(room => {
    adjacencyList.set(getRoomId(room), { room, connections: [] });
  });

  // Add edges
  edges.forEach(edge => {
    const fromRoom = roomMap.get(edge.from);
    const toRoom = roomMap.get(edge.to);
    
    if (fromRoom && toRoom) {
      const fromEntry = adjacencyList.get(edge.from);
      if (fromEntry) {
        fromEntry.connections.push({ target: toRoom, type: edge.connection_type });
      }
    }
  });

  return adjacencyList;
}

// Format connection type for display
function formatConnectionType(type: string): string {
  const types: Record<string, string> = {
    door: "door",
    opening: "open",
    archway: "arch",
    pass_through: "pass",
    unknown: "→",
  };
  return types[type] || "→";
}

export function SpaceGraphSummary({ 
  spatialMap, 
  isLoading, 
  error,
  onRetry 
}: SpaceGraphSummaryProps) {
  if (isLoading) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-primary">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Analyzing architectural graph...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Failed to analyze space graph</span>
            </div>
            {onRetry && (
              <button 
                onClick={onRetry}
                className="text-sm text-primary hover:underline"
              >
                Retry
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  if (!spatialMap || spatialMap.rooms.length === 0) {
    return null;
  }

  const rooms = spatialMap.rooms;
  const edges = spatialMap.adjacency_graph;
  const locks = spatialMap.locks_json?.furniture_locks || [];
  const hints = spatialMap.locks_json?.visibility_hints || [];
  
  const adjacencyList = buildAdjacencyList(rooms, edges);
  
  // Separate rooms and zones
  const habitable = rooms.filter(r => r.type === "room");
  const zones = rooms.filter(r => r.type === "zone");

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" />
            Space Graph Summary
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs">
              {rooms.length} spaces
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {edges.length} connections
            </Badge>
            {locks.length > 0 && (
              <Badge variant="outline" className="text-xs">
                <Lock className="w-3 h-3 mr-1" />
                {locks.length} locks
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-3">
        {/* Room List with Connections */}
        <div className="space-y-2">
          {/* Habitable Rooms */}
          {habitable.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <Home className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Rooms</span>
              </div>
              <div className="space-y-1">
                {habitable.map(room => {
                  const entry = adjacencyList.get(getRoomId(room));
                  return (
                    <RoomConnectionRow 
                      key={getRoomId(room)} 
                      room={room} 
                      connections={entry?.connections || []}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Zones/Corridors */}
          {zones.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1.5">
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Zones & Corridors</span>
              </div>
              <div className="space-y-1">
                {zones.map(room => {
                  const entry = adjacencyList.get(getRoomId(room));
                  return (
                    <RoomConnectionRow 
                      key={getRoomId(room)} 
                      room={room} 
                      connections={entry?.connections || []}
                      isZone
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Locks Preview */}
        {locks.length > 0 && (
          <div className="pt-2 border-t border-border/30">
            <div className="flex items-center gap-1 mb-1.5">
              <Lock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Furniture Constraints</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {locks.slice(0, 4).map((lock, idx) => {
                const room = rooms.find(r => getRoomId(r) === lock.room_id);
                const mustInclude = lock.must_include?.slice(0, 2) || [];
                return (
                  <Badge 
                    key={idx} 
                    variant="outline" 
                    className="text-xs bg-secondary/30"
                  >
                    {room ? getRoomDisplayName(room) : lock.room_id}: 
                    {mustInclude.length > 0 
                      ? ` ${mustInclude.join(", ")}` 
                      : " (general)"}
                  </Badge>
                );
              })}
              {locks.length > 4 && (
                <Badge variant="outline" className="text-xs">
                  +{locks.length - 4} more
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Visibility Hints Preview */}
        {hints.length > 0 && (
          <div className="pt-2 border-t border-border/30">
            <div className="flex items-center gap-1 mb-1.5">
              <Eye className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Visibility Notes</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {hints.slice(0, 2).map((hint, idx) => {
                const room = rooms.find(r => getRoomId(r) === hint.room_id);
                return (
                  <div key={idx} className="flex items-start gap-1">
                    <span className="font-medium">
                      {room ? getRoomDisplayName(room) : hint.room_id}:
                    </span>
                    <span>{hint.hints[0]}</span>
                  </div>
                );
              })}
              {hints.length > 2 && (
                <span className="text-muted-foreground/70">
                  +{hints.length - 2} more hints
                </span>
              )}
            </div>
          </div>
        )}

        {/* Version indicator */}
        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3 h-3 text-primary" />
            Graph v{spatialMap.version} stored
          </div>
          <span className="text-xs text-muted-foreground">
            {new Date(spatialMap.updated_at || spatialMap.created_at).toLocaleTimeString()}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Sub-component for room connection row
function RoomConnectionRow({ 
  room, 
  connections,
  isZone = false 
}: { 
  room: DetectedRoom; 
  connections: Array<{ target: DetectedRoom; type: string }>;
  isZone?: boolean;
}) {
  return (
    <div className={cn(
      "flex items-center gap-2 text-xs py-1 px-2 rounded",
      isZone ? "bg-muted/30" : "bg-secondary/30"
    )}>
      <Badge 
        variant={isZone ? "outline" : "secondary"} 
        className={cn("text-xs shrink-0", isZone && "bg-muted/50")}
      >
        {getRoomDisplayName(room)}
      </Badge>
      
      {connections.length > 0 && (
        <>
          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
          <div className="flex flex-wrap gap-1 min-w-0">
            {connections.slice(0, 4).map((conn, idx) => (
              <span 
                key={idx}
                className="inline-flex items-center gap-0.5 text-muted-foreground"
              >
                <span className="text-foreground/80">
                  {getRoomDisplayName(conn.target)}
                </span>
                <span className="text-muted-foreground/60 text-[10px]">
                  ({formatConnectionType(conn.type)})
                </span>
                {idx < Math.min(connections.length - 1, 3) && ","}
              </span>
            ))}
            {connections.length > 4 && (
              <span className="text-muted-foreground">+{connections.length - 4}</span>
            )}
          </div>
        </>
      )}
      
      {connections.length === 0 && (
        <span className="text-muted-foreground/60 italic">isolated</span>
      )}
      
      {room.confidence < 0.7 && (
        <Badge variant="outline" className="text-[10px] border-warning/30 ml-auto">
          low conf
        </Badge>
      )}
    </div>
  );
}
