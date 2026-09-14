import { LiveTrafficTelemetry, TrafficNode } from "./types";
import kbData from "../data/hyderabad_kb.json";

const nodes: TrafficNode[] = kbData as TrafficNode[];

export async function fetchLiveTraffic(
  lat: number,
  lng: number,
  junctionName?: string,
  junctionId?: string
): Promise<LiveTrafficTelemetry> {
  const apiKey = process.env.TOMTOM_API_KEY;
  const targetName = junctionName || findClosestJunction(lat, lng) || "Hyderabad Transit Corridor";
  const targetId = junctionId || targetName.toLowerCase().replace(/\s+/g, "-");

  if (apiKey && apiKey.trim() !== "" && apiKey !== "your_tomtom_api_key_here") {
    try {
      const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/relative0/10/json?point=${lat},${lng}&unit=KMPH&key=${apiKey}`;
      const res = await fetch(url, { next: { revalidate: 60 } });

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

          return {
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
            confidence: flow.confidence || 0.9,
            isSimulated: false,
            timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
          };
        }
      }
    } catch (err) {
      console.warn("TomTom live API call failed, switching to realistic simulation fallback:", err);
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
  // Get current hour in IST
  const istFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    hour12: false,
  });
  const currentHour = parseInt(istFormatter.format(now), 10);

  // Peak hours: 8:30-11:30 AM (8-11) and 5:30-9:00 PM (17-21)
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
    if (junctionId.includes("cyber") || junctionId.includes("gachibowli") || junctionId.includes("ameerpet")) {
      currentSpeed = Math.round(14 + Math.random() * 8);
      status = "Severe Gridlock";
      delayMinutes = Math.round(15 + Math.random() * 12);
    } else {
      currentSpeed = Math.round(freeFlow * 0.45 + Math.random() * 10);
      status = "Heavy Congestion";
      delayMinutes = Math.round(8 + Math.random() * 6);
    }
  } else if (currentHour >= 12 && currentHour <= 16) {
    currentSpeed = Math.round(freeFlow * 0.75 + Math.random() * 5);
    status = "Moderate Traffic";
    delayMinutes = Math.round(2 + Math.random() * 4);
  } else {
    currentSpeed = Math.round(freeFlow * 0.95);
    status = "Free Flow";
    delayMinutes = 0;
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
    confidence: 0.88,
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
