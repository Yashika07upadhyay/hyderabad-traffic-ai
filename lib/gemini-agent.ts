import { GoogleGenerativeAI } from "@google/generative-ai";
import { searchKnowledgeBase } from "./embeddings";
import { fetchLiveTraffic } from "./tomtom";
import { LiveTrafficTelemetry, TrafficNode } from "./types";
import kbData from "../data/hyderabad_kb.json";

const nodes: TrafficNode[] = kbData as TrafficNode[];

function matchJunction(locationQuery: string): TrafficNode {
  const queryLower = locationQuery.toLowerCase();

  if (
    (queryLower.includes("amb") || queryLower.includes("sarath")) &&
    queryLower.includes("dlf")
  ) {
    return nodes.find((n) => n.id === "amb-to-dlf") || nodes[0];
  }

  if (
    queryLower.includes("financial") &&
    (queryLower.includes("dlf") || queryLower.includes("gachibowli"))
  ) {
    return nodes.find((n) => n.id === "financial-to-dlf") || nodes[2];
  }

  if (
    queryLower.includes("airport") ||
    queryLower.includes("shamshabad") ||
    queryLower.includes("pvnr")
  ) {
    return nodes.find((n) => n.id === "gachibowli-to-airport") || nodes[3];
  }

  if (
    queryLower.includes("cyber") ||
    queryLower.includes("mindspace") ||
    queryLower.includes("raidurg") ||
    queryLower.includes("madhapur")
  ) {
    return nodes.find((n) => n.id === "cyber-to-mindspace") || nodes[1];
  }

  if (
    queryLower.includes("cable") ||
    queryLower.includes("durgam") ||
    queryLower.includes("jubilee")
  ) {
    return nodes.find((n) => n.id === "durgam-cheruvu-bridge") || nodes[4];
  }

  const match = nodes.find(
    (n) =>
      n.name.toLowerCase().includes(queryLower) ||
      n.id.toLowerCase().includes(queryLower) ||
      n.area.toLowerCase().includes(queryLower)
  );

  return match || nodes[0];
}

export async function runTransitAgent(
  userQuery: string,
  chatHistory: { role: "user" | "assistant"; content: string }[] = []
): Promise<{
  response: string;
  ragSources: string[];
  liveTelemetry: LiveTrafficTelemetry | null;
}> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Step 1: Match corridor and query live sensor
  const matched = matchJunction(userQuery);

  const [ragResults, liveTelemetry] = await Promise.all([
    searchKnowledgeBase(userQuery, 2),
    fetchLiveTraffic(
      matched.coordinates.lat,
      matched.coordinates.lng,
      matched.name,
      matched.id
    ),
  ]);

  // Spatial Guard: Ensure cited sources belong exclusively to the queried corridor/zone
  const ragSources = [matched.name];
  for (const r of ragResults) {
    // Only include secondary citation if it shares the exact same zone AND isn't already cited
    if (r.node.name !== matched.name && r.node.area === matched.area) {
      ragSources.push(r.node.name);
    }
  }

  const routes = matched.routeOptions || [];
  const primaryRoute = routes[0];
  const secondaryRoute = routes[1];

  const currentSpeed = Math.max(liveTelemetry.currentSpeedKmph, 15);
  const calcTime = (km: number) =>
    Math.max(4, Math.round((km / currentSpeed) * 60 + liveTelemetry.delayMinutes * 0.5));

  const primaryTimeMins = primaryRoute ? calcTime(primaryRoute.distanceKm) : 8;
  const secondaryTimeMins = secondaryRoute ? calcTime(secondaryRoute.distanceKm) : null;

  // Step 2: Clean Instant Fallback Generator (100% geographically verified)
  const generateFallbackResponse = (): string => {
    if (routes.length === 1 || !secondaryRoute) {
      return `The drive along **${matched.name}** is a direct **~${primaryRoute.distanceKm} km** stretch taking approximately **~${primaryTimeMins} minutes** right now, with road speeds averaging **${liveTelemetry.currentSpeedKmph} km/h** (${liveTelemetry.congestionStatus}).

**Boundary Landmarks:** ${(matched.landmarks || []).join(" ➔ ")}

---

🎯 **Yashika's Suggestion:**
Take **${primaryRoute.name}** to reach in **~${primaryTimeMins} mins**! Watch for curb-side congestion near the terminal/gate drop-offs.`;
    }

    const fasterRoute =
      primaryTimeMins <= (secondaryTimeMins || 99) ? primaryRoute : secondaryRoute;
    const slowerRoute =
      primaryTimeMins <= (secondaryTimeMins || 99) ? secondaryRoute : primaryRoute;
    const fasterTime = Math.min(primaryTimeMins, secondaryTimeMins || 99);
    const slowerTime = Math.max(primaryTimeMins, secondaryTimeMins || 0);
    const timeSaved = slowerTime - fasterTime;

    return `Here is the real-time commute comparison for **${matched.name}**:

**Current Flow:** **${liveTelemetry.currentSpeedKmph} km/h** (${liveTelemetry.congestionStatus}, ~${liveTelemetry.delayMinutes} min delay)
**Key Landmarks:** ${(matched.landmarks || []).join(" ➔ ")}

---

#### 🛣️ Available Route Options:
1. **${primaryRoute.name}**
   * **Distance:** ~${primaryRoute.distanceKm} km | **Estimated Time:** **~${primaryTimeMins} mins**
   * *Profile:* ${primaryRoute.description}

2. **${secondaryRoute.name}**
   * **Distance:** ~${secondaryRoute.distanceKm} km | **Estimated Time:** **~${secondaryTimeMins} mins**
   * *Profile:* ${secondaryRoute.description}

---

🎯 **Yashika's Suggestion:**
Take **${fasterRoute.name}** to reach in **~${fasterTime} mins**${
      timeSaved > 0 ? ` (saving **~${timeSaved} mins** over ${slowerRoute.name})` : ""
    }!`;
  };

  if (!apiKey || apiKey.trim() === "" || apiKey === "your_gemini_api_key_here") {
    return {
      response: generateFallbackResponse(),
      ragSources,
      liveTelemetry,
    };
  }

  // Step 3: Fast Generation via gemini-flash-lite-latest with verified spatial landmarks
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });

    const prompt = `You are 'Hyderabad Transit AI', an expert urban mobility specialist for Hyderabad.

GEOGRAPHIC LOCATION & SENSOR TELEMETRY:
- Target Corridor: ${matched.name}
- Zone/Area: ${matched.area}
- Boundary Landmarks: ${(matched.landmarks || []).join(" ➔ ")}
- Live Road Speed (TomTom): ${liveTelemetry.currentSpeedKmph} km/h (Free-flow target: ${liveTelemetry.freeFlowSpeedKmph} km/h)
- Delay: +${liveTelemetry.delayMinutes} mins (${liveTelemetry.congestionStatus})
- Choke Points: ${matched.chokePoints.join(", ")}

ROUTE DETAILS:
${
  routes.length === 1
    ? `- Direct single stretch: "${primaryRoute.name}" (~${primaryRoute.distanceKm} km). Estimated time at current speed: ~${primaryTimeMins} mins.`
    : routes
        .map(
          (r, i) =>
            `- Route ${i + 1}: ${r.name} (~${r.distanceKm} km, estimated time ~${
              i === 0 ? primaryTimeMins : secondaryTimeMins
            } mins). Profile: ${r.description}`
        )
        .join("\n")
}

USER QUERY: "${userQuery}"

GEOGRAPHIC INTEGRITY RULES:
1. ONLY refer to landmarks and roads within "${matched.name}" and "${matched.area}". DO NOT mention or conflate other distant areas (e.g. do not mention Financial District or DLF when analyzing Cyber Towers to Mindspace in Madhapur).
2. Report the verified distance (e.g. ~${primaryRoute.distanceKm} km) and realistic travel time (~${primaryTimeMins} mins).
3. If comparing routes, contrast the two options clearly with estimated minutes.
4. Conclude with:
🎯 **Yashika's Suggestion**: [Your actionable recommendation with exact route name, estimated minutes, and bottleneck tips]`;

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("LLM generation timeout")), 4000)
    );

    const generatePromise = model.generateContent(prompt);
    const result = await Promise.race([generatePromise, timeoutPromise]);
    const responseText = result.response.text();

    return {
      response: responseText,
      ragSources,
      liveTelemetry,
    };
  } catch (err) {
    console.warn("Using instant local fallback generator due to latency or timeout:", err);
    return {
      response: generateFallbackResponse(),
      ragSources,
      liveTelemetry,
    };
  }
}
