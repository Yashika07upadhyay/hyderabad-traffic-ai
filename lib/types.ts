export interface RouteOption {
  name: string;
  distanceKm: number;
  baseTimeMins: number;
  description: string;
}

export interface TrafficNode {
  id: string;
  name: string;
  area: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  chokePoints: string[];
  landmarks?: string[];
  peakHours: string;
  trafficPatterns: string;
  routeOptions?: RouteOption[];
}

export interface LiveTrafficTelemetry {
  junctionId: string;
  junctionName: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  currentSpeedKmph: number;
  freeFlowSpeedKmph: number;
  speedRatioPercent: number;
  delaySeconds: number;
  delayMinutes: number;
  congestionStatus: "Free Flow" | "Moderate Traffic" | "Heavy Congestion" | "Severe Gridlock";
  roadClosure: boolean;
  confidence: number;
  isSimulated: boolean;
  timestamp: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  telemetry?: LiveTrafficTelemetry | null;
  ragSources?: string[];
}
