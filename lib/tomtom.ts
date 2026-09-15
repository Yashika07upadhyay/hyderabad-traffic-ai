import { LiveTrafficTelemetry, TrafficNode } from "./types";
import kbData from "../data/hyderabad_kb.json";

const nodes: TrafficNode[] = kbData as TrafficNode[];

// In-memory 30-second TTL cache for TomTom queries to make repeated queries instant
const telemetryCache = new Map<string, { data: LiveTrafficTelemetry; expiresAt: number }>();

export async function fetchLiveTraffic(
  lat: number,
  lng: number,
  junctionName?: string,
  junctionId?: string
): Promise<LiveTrafficTelemetry> {
  const apiKey = process.env.TOMTOM_API_KEY;
  const targetName = junctionName || findClosestJunction(lat, lng) || "Hyderabad Transit Corridor";
  const targetId = junctionId || targetName.toLowerCase().replace(/\s+/g, "-");

  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = telemetryCache.get(cacheKey);
  const now = Date.now();

  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  if (apiKey && apiKey.trim() !== "" && apiKey !== "your_tomtom_api_key_here") {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500); // 2.5s hard timeout

      const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?point=${lat},${lng}&unit=KMPH&key=${apiKey}`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const flow = data.flowSegmentData;

        if (flow) {
          const currentSpeed = Math.round(flow.currentSpeed);
          const freeFlowSpeed = Math.max(flow.freeFlowSpeed, currentSpeed, 30);
          const delaySeconds = Math.max(0, flow.currentTravelTime - flow.freeFlowTravelTime);
          const speedRatio = Math.round((currentSpeed / freeFlowSpeed) * 100);

          let status: LiveTrafficTelemetry["congestionStatus"] = "Free Flow";
          if (speedRatio < 35 || flow.roadClosure) {
            status = "Severe Gridlock";
          } else if (speedRatio < 60) {
            status = "Heavy Congestion";
          } else if (speedRatio < 85) {
            status = "Moderate Traffic";
          }

          const telemetry: LiveTrafficTelemetry = {
            junctionId: targetId,
            junctionName: targetName,
            coordinates: { lat, lng },
            currentSpeedKmph: currentSpeed,
            freeFlowSpeedKmph: freeFlowSpeed,
            speedRatioPercent: speedRatio,
            delaySeconds,
            delayMinutes: Math.round(delaySeconds / 60),
            congestionStatus: status,
            roadClosure: Boolean(flow.roadClosure),
            confidence: flow.confidence || 0.95,
            isSimulated: false,
            timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
          };

          // Cache for 30 seconds
          telemetryCache.set(cacheKey, { data: telemetry, expiresAt: now + 30000 });
          return telemetry;
        }
      }
    } catch (err) {
      console.warn("TomTom live API timed out or failed, using local model:", err);
    }
  }

  // Graceful realistic IST-aware simulation fallback
  return simulateLiveTraffic(lat, lng, targetName, targetId);
}

function simulateLiveTraffic(
  lat: number,
  lng: number,
  junctionName: string,
  junctionId: string
): LiveTrafficTelemetry {
  const now = new Date();
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  });
  const currentHour = parseInt(istFormatter.format(now), 10);

  const isMorningPeak = currentHour >= 8 && currentHour <= 11;
  const isEveningPeak = currentHour >= 17 && currentHour <= 21;
  const isPeak = isMorningPeak || isEveningPeak;

  let freeFlow = 50;
  if (junctionId.includes("orr")) freeFlow = 100;
  else if (junctionId.includes("pvnr")) freeFlow = 70;
  else if (junctionId.includes("bridge")) freeFlow = 55;

  let currentSpeed = freeFlow;
  let status: LiveTrafficTelemetry["congestionStatus"] = "Free Flow";
  let delayMinutes = 0;

  if (isPeak) {
    if (junctionId.includes("amb") || junctionId.includes("dlf") || junctionId.includes("cyber")) {
      currentSpeed = Math.round(18 + Math.random() * 8);
      status = "Moderate Traffic";
      delayMinutes = Math.round(4 + Math.random() * 5);
    } else {
      currentSpeed = Math.round(freeFlow * 0.5 + Math.random() * 10);
      status = "Heavy Congestion";
      delayMinutes = Math.round(8 + Math.random() * 6);
    }
  } else {
    currentSpeed = Math.round(freeFlow * 0.85);
    status = "Free Flow";
    delayMinutes = 1;
  }

  const speedRatio = Math.round((currentSpeed / freeFlow) * 100);

  return {
    junctionId,
    junctionName,
    coordinates: { lat, lng },
    currentSpeedKmph: currentSpeed,
    freeFlowSpeedKmph: freeFlow,
    speedRatioPercent: speedRatio,
    delaySeconds: delayMinutes * 60,
    delayMinutes,
    congestionStatus: status,
    roadClosure: false,
    confidence: 0.9,
    isSimulated: true,
    timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
  };
}

function findClosestJunction(lat: number, lng: number): string | null {
  let closest: TrafficNode | null = null;
  let minDistance = Infinity;

  for (const node of nodes) {
    const dist = Math.hypot(node.coordinates.lat - lat, node.coordinates.lng - lng);
    if (dist < minDistance) {
      minDistance = dist;
      closest = node;
    }
  }

  return closest ? closest.name : null;
}
