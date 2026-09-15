import { GoogleGenerativeAI, SchemaType, Tool } from "@google/generative-ai";
import { searchKnowledgeBase } from "./embeddings";
import { fetchLiveTraffic } from "./tomtom";
import { LiveTrafficTelemetry, TrafficNode } from "./types";
import kbData from "../data/hyderabad_kb.json";

const nodes: TrafficNode[] = kbData as TrafficNode[];

// Tool definition for Gemini Function Calling
const liveTrafficTool: Tool = {
  functionDeclarations: [
    {
      name: "get_live_traffic_flow",
      description:
        "Fetches real-time traffic flow speed, congestion level, and delays for a specific junction, road, or area in Hyderabad from TomTom traffic sensors.",
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          locationName: {
            type: SchemaType.STRING,
            description:
              "The name or landmark of the Hyderabad junction (e.g., 'AMB Cinemas', 'DLF Cyber City', 'Financial District', 'Cyber Towers', 'Gachibowli', 'Durgam Cheruvu', 'PVNR Expressway').",
          },
        },
        required: ["locationName"],
      },
    },
  ],
};

function matchJunction(locationQuery: string): TrafficNode {
  const queryLower = locationQuery.toLowerCase();
  const match = nodes.find(
    (n) =>
      n.name.toLowerCase().includes(queryLower) ||
      n.id.toLowerCase().includes(queryLower) ||
      n.area.toLowerCase().includes(queryLower) ||
      queryLower.includes(n.id.split("-")[0]) ||
      (n.id.includes("amb") && (queryLower.includes("amb") || queryLower.includes("sarath"))) ||
      (n.id.includes("dlf") && queryLower.includes("dlf")) ||
      (n.id.includes("financial") && queryLower.includes("financial"))
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

  // Step 1: RAG Retrieval
  const ragResults = await searchKnowledgeBase(userQuery, 2);
  const ragSources = ragResults.map((r) => r.node.name);
  const ragContext = ragResults
    .map((r, i) => {
      const routesText = r.node.routeOptions
        ?.map((ro) => `  * ${ro.name}: ~${ro.distanceKm} km, base time ${ro.baseTimeMins}m (${ro.description})`)
        .join("\n") || "No explicit route alternatives recorded.";
      return `[Context ${i + 1}: ${r.node.name} (${r.node.area})]
- Choke Points: ${r.node.chokePoints.join(", ")}
- Peak Hours: ${r.node.peakHours}
- Route Options & Distance:
${routesText}`;
    })
    .join("\n\n");

  let capturedTelemetry: LiveTrafficTelemetry | null = null;

  // Direct structured handler for fallback / offline
  const generateCleanResponse = (node: TrafficNode, telemetry: LiveTrafficTelemetry): string => {
    const routes = node.routeOptions || [
      {
        name: "Primary Arterial Corridor",
        distanceKm: 4.5,
        baseTimeMins: 18,
        description: "Direct road route with signal junctions",
      },
      {
        name: "Elevated / Service Road Bypass",
        distanceKm: 6.0,
        baseTimeMins: 24,
        description: "Bypasses ground traffic",
      },
    ];

    // Compute expected times based on live congestion delay
    const delay = telemetry.delayMinutes;
    const timeRoute1 = Math.round(routes[0].baseTimeMins + delay * 0.4);
    const timeRoute2 = Math.round((routes[1]?.baseTimeMins || 24) + delay * 0.8);

    const isFirstFaster = timeRoute1 <= timeRoute2;
    const fasterRoute = isFirstFaster ? routes[0] : routes[1];
    const slowerRoute = isFirstFaster ? routes[1] : routes[0];
    const fasterTime = isFirstFaster ? timeRoute1 : timeRoute2;
    const slowerTime = isFirstFaster ? timeRoute2 : timeRoute1;
    const timeSaved = slowerTime - fasterTime;

    return `### 🚦 Commute Analysis: **${node.name}**

**Current Road Speed:** **${telemetry.currentSpeedKmph} km/h** (Free-flow: ${telemetry.freeFlowSpeedKmph} km/h) • Status: **${telemetry.congestionStatus}** (~${telemetry.delayMinutes} min delay)

---

#### 🛣️ Available Route Options:
1. **${routes[0].name}**
   * **Distance:** ~${routes[0].distanceKm} km | **Estimated Time:** **~${timeRoute1} mins**
   * *Profile:* ${routes[0].description}

2. **${routes[1]?.name || "Alternate Bypass"}**
   * **Distance:** ~${routes[1]?.distanceKm || 6.0} km | **Estimated Time:** **~${timeRoute2} mins**
   * *Profile:* ${routes[1]?.description || "Secondary corridor"}

---

🎯 **Yashika's Suggestion:**
Take **${fasterRoute.name}** to reach in **~${fasterTime} mins**${timeSaved > 0 ? ` (saving **~${timeSaved} mins** over ${slowerRoute.name})` : ""}!`;
  };

  // If GEMINI_API_KEY is not supplied, use clean local synthesis
  if (!apiKey || apiKey.trim() === "" || apiKey === "your_gemini_api_key_here") {
    const matched = matchJunction(userQuery);
    capturedTelemetry = await fetchLiveTraffic(
      matched.coordinates.lat,
      matched.coordinates.lng,
      matched.name,
      matched.id
    );

    return {
      response: generateCleanResponse(matched, capturedTelemetry),
      ragSources,
      liveTelemetry: capturedTelemetry,
    };
  }

  // Step 2: Live Gemini Agent Execution (gemini-3.6-flash)
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-3.6-flash",
      tools: [liveTrafficTool],
      systemInstruction: `You are 'Hyderabad Transit AI', an expert urban mobility and traffic routing specialist for Hyderabad.
You have access to:
1. Grounded RAG Knowledge Base of Hyderabad arterial corridors, road options, and choke points.
2. Tool 'get_live_traffic_flow' for live TomTom road speed and congestion telemetry.

CRITICAL INSTRUCTIONS:
- NEVER mention public transit, metro lines, or distant unrelated junctions (like Ameerpet/Secunderabad) unless the user specifically asks for public transit. Commuters asking for routes want DRIVING road options.
- When the user asks about going between two places (e.g. AMB to DLF, Financial District to DLF, etc.):
  1. Always call 'get_live_traffic_flow' for the relevant junction or corridor.
  2. Display the live speed status and delay.
  3. Compare the practical driving routes with expected travel times (in minutes) based on the live delay.
  4. Conclude with a highlighted recommendation exactly in this format:
     🎯 **Yashika's Suggestion**: Take [Faster Route Name] for reaching in **[X] mins** (saving ~[Y] mins over [Other Route])!

Context retrieved from Hyderabad Knowledge Base:
${ragContext}`,
    });

    const chat = model.startChat({
      history: chatHistory.slice(-4).map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      })),
    });

    let result = await chat.sendMessage(userQuery);
    let call = result.response.functionCalls()?.[0];

    // Tool execution loop
    if (call && call.name === "get_live_traffic_flow") {
      const loc = (call.args as { locationName?: string }).locationName || userQuery;
      const matched = matchJunction(loc);
      capturedTelemetry = await fetchLiveTraffic(
        matched.coordinates.lat,
        matched.coordinates.lng,
        matched.name,
        matched.id
      );

      // Send tool response back to Gemini
      result = await chat.sendMessage([
        {
          functionResponse: {
            name: "get_live_traffic_flow",
            response: {
              junction: capturedTelemetry.junctionName,
              currentSpeedKmph: capturedTelemetry.currentSpeedKmph,
              freeFlowSpeedKmph: capturedTelemetry.freeFlowSpeedKmph,
              delayMinutes: capturedTelemetry.delayMinutes,
              congestionStatus: capturedTelemetry.congestionStatus,
              roadClosure: capturedTelemetry.roadClosure,
            },
          },
        },
      ]);
    } else {
      // If the LLM didn't invoke the tool directly, fetch telemetry for the matched junction
      const matched = matchJunction(userQuery);
      capturedTelemetry = await fetchLiveTraffic(
        matched.coordinates.lat,
        matched.coordinates.lng,
        matched.name,
        matched.id
      );
    }

    const finalResponseText = result.response.text();

    return {
      response: finalResponseText,
      ragSources,
      liveTelemetry: capturedTelemetry,
    };
  } catch (err) {
    console.error("Agent execution error:", err);
    const matched = matchJunction(userQuery);
    capturedTelemetry = await fetchLiveTraffic(
      matched.coordinates.lat,
      matched.coordinates.lng,
      matched.name,
      matched.id
    );

    return {
      response: generateCleanResponse(matched, capturedTelemetry),
      ragSources,
      liveTelemetry: capturedTelemetry,
    };
  }
}
