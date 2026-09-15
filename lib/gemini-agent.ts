import { GoogleGenerativeAI } from "@google/generative-ai";
import { searchKnowledgeBase } from "./embeddings";
import { fetchLiveTraffic } from "./tomtom";
import { LiveTrafficTelemetry, TrafficNode } from "./types";
import kbData from "../data/hyderabad_kb.json";

const nodes: TrafficNode[] = kbData as TrafficNode[];

function matchJunction(locationQuery: string): TrafficNode {
  const queryLower = locationQuery.toLowerCase();

  // Explicit corridor matching for common queries
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
    return nodes.find((n) => n.id === "financial-to-dlf") || nodes[1];
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
    queryLower.includes("raidurg")
  ) {
    return nodes.find((n) => n.id === "cyber-to-mindspace") || nodes[2];
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

  // Step 1: Identify Corridor and Query RAG Context
  const matched = matchJunction(userQuery);
  const ragResults = await searchKnowledgeBase(userQuery, 2);
  const ragSources = [matched.name, ...ragResults.map((r) => r.node.name).filter((n) => n !== matched.name)];

  // Step 2: Fetch Live Traffic Telemetry from TomTom API
  const liveTelemetry = await fetchLiveTraffic(
    matched.coordinates.lat,
    matched.coordinates.lng,
    matched.name,
    matched.id
  );

  const routes = matched.routeOptions || [];
  const primaryRoute = routes[0];
  const secondaryRoute = routes[1];

  // Realistic time calculations based on live speed and distance
  const currentSpeed = Math.max(liveTelemetry.currentSpeedKmph, 15);
  const calcTime = (km: number) => Math.max(5, Math.round((km / currentSpeed) * 60 + liveTelemetry.delayMinutes * 0.5));

  const primaryTimeMins = primaryRoute ? calcTime(primaryRoute.distanceKm) : 10;
  const secondaryTimeMins = secondaryRoute ? calcTime(secondaryRoute.distanceKm) : null;

  // Step 3: Direct fallback generator if Gemini API key is missing
  const generateFallbackResponse = (): string => {
    if (routes.length === 1 || !secondaryRoute) {
      // Single direct route scenario (like AMB to DLF)
      return `The drive from **${matched.name}** is a direct **~${primaryRoute.distanceKm} km** trip that takes approximately **~${primaryTimeMins} minutes** right now, with current road speeds averaging **${liveTelemetry.currentSpeedKmph} km/h** (${liveTelemetry.congestionStatus}).

To ensure the fastest commute, follow **${primaryRoute.name}**. Hop onto the elevated flyover as soon as you exit the mall area to completely skip the ground-level signal at Botanical Garden.

---

🎯 **Yashika's Suggestion:**
Take **${primaryRoute.name}** to reach in **~${primaryTimeMins} mins**! Stay on the right lane of the flyover to bypass the Botanical Garden ground junction, but slow down near DLF gate where food stalls cause curb-side friction.`;
    }

    // Multi-route scenario (like Financial District to DLF or Airport)
    const fasterRoute = primaryTimeMins <= (secondaryTimeMins || 99) ? primaryRoute : secondaryRoute;
    const slowerRoute = primaryTimeMins <= (secondaryTimeMins || 99) ? secondaryRoute : primaryRoute;
    const fasterTime = Math.min(primaryTimeMins, secondaryTimeMins || 99);
    const slowerTime = Math.max(primaryTimeMins, secondaryTimeMins || 0);
    const timeSaved = slowerTime - fasterTime;

    return `Here is the real-time commute comparison for **${matched.name}**:

**Current Flow:** **${liveTelemetry.currentSpeedKmph} km/h** (${liveTelemetry.congestionStatus}, ~${liveTelemetry.delayMinutes} min delay)

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
Take **${fasterRoute.name}** to reach in **~${fasterTime} mins**${timeSaved > 0 ? ` (saving **~${timeSaved} mins** over ${slowerRoute.name})` : ""}!`;
  };

  if (!apiKey || apiKey.trim() === "" || apiKey === "your_gemini_api_key_here") {
    return {
      response: generateFallbackResponse(),
      ragSources,
      liveTelemetry,
    };
  }

  // Step 4: Live Generation via Gemini 3.6 Flash
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

    const prompt = `You are 'Hyderabad Transit AI', a real-time urban mobility specialist for Hyderabad commuters.

LIVE SENSOR DATA (TomTom Traffic API):
- Corridor: ${matched.name} (${matched.area})
- Current Road Speed: ${liveTelemetry.currentSpeedKmph} km/h
- Free-Flow Target Speed: ${liveTelemetry.freeFlowSpeedKmph} km/h
- Delay: +${liveTelemetry.delayMinutes} mins
- Traffic Status: ${liveTelemetry.congestionStatus}
- Known Choke Points: ${matched.chokePoints.join(", ")}

ROUTE INTELLIGENCE:
${
  routes.length === 1
    ? `- This is a single direct short stretch: "${primaryRoute.name}" (~${primaryRoute.distanceKm} km).
- Real driving time at current speed: ~${primaryTimeMins} mins.
- Key advice: Take the Kothaguda multi-level flyover to avoid Botanical Garden ground signal.`
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

INSTRUCTIONS:
1. Give a crisp, highly realistic Hyderabad commuter advisory based on the live TomTom speed (${liveTelemetry.currentSpeedKmph} km/h).
2. If the query is about a short direct stretch (like AMB to DLF), state clearly that it is a quick ~${primaryRoute.distanceKm} km drive taking only ~${primaryTimeMins} minutes right now. Do NOT invent unnecessary detours when there is only one obvious road.
3. If there are multiple viable routes (like Financial District to DLF), compare the two routes with distance and estimated minutes.
4. Conclude with:
🎯 **Yashika's Suggestion**: [Your direct, actionable recommendation with exact route name, estimated minutes, and lane/flyover tip]`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    return {
      response: responseText,
      ragSources,
      liveTelemetry,
    };
  } catch (err) {
    console.error("Gemini API error in transit agent, using grounded fallback:", err);
    return {
      response: generateFallbackResponse(),
      ragSources,
      liveTelemetry,
    };
  }
}
