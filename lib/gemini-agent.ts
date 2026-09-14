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
              "The name or landmark of the Hyderabad junction (e.g., 'Cyber Towers', 'Gachibowli', 'Durgam Cheruvu', 'Ameerpet', 'PVNR Expressway', 'KPHB', 'ORR').",
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
      queryLower.includes(n.name.toLowerCase().split(" ")[0])
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
  const ragResults = await searchKnowledgeBase(userQuery, 3);
  const ragSources = ragResults.map((r) => r.node.name);
  const ragContext = ragResults
    .map(
      (r, i) =>
        `[Context ${i + 1}: ${r.node.name} (${r.node.area})]
- Choke Points: ${r.node.chokePoints.join(", ")}
- Peak Hours: ${r.node.peakHours}
- Detours & Alternates: ${r.node.alternateRoutes.join("; ")}
- Public Transit: ${r.node.publicTransit}
- Monsoon / Waterlogging: ${r.node.monsoonRisks}`
    )
    .join("\n\n");

  let capturedTelemetry: LiveTrafficTelemetry | null = null;

  // Fallback simulator if GEMINI_API_KEY is not yet supplied
  if (!apiKey || apiKey.trim() === "" || apiKey === "your_gemini_api_key_here") {
    const matched = matchJunction(userQuery);
    capturedTelemetry = await fetchLiveTraffic(
      matched.coordinates.lat,
      matched.coordinates.lng,
      matched.name,
      matched.id
    );

    const fallbackResponse = `### 🚦 Transit Advisory for **${matched.name}**

**Live Speed Status:** Currently running at **${capturedTelemetry.currentSpeedKmph} km/h** (Free-flow: ${capturedTelemetry.freeFlowSpeedKmph} km/h) with an estimated **${capturedTelemetry.delayMinutes} min delay**.

#### 🧭 Commute & Detour Recommendations:
${matched.alternateRoutes.map((r) => `* **Detour:** ${r}`).join("\n")}

#### 🚆 Public Transit Alternative:
* ${matched.publicTransit}

#### ⚠️ Choke Points to Expect:
* ${matched.chokePoints.join("\n* ")}

*(Note: Grounded via RAG knowledge base & autonomous traffic sensors. Add \`GEMINI_API_KEY\` to .env.local for full interactive conversational streaming).*`;

    return {
      response: fallbackResponse,
      ragSources,
      liveTelemetry: capturedTelemetry,
    };
  }

  // Step 2: Gemini Tool-Calling Agent Execution
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      tools: [liveTrafficTool],
      systemInstruction: `You are 'Hyderabad Transit AI', an expert urban mobility and traffic routing agent for Hyderabad.
You have access to:
1. Grounded RAG Knowledge Base of Hyderabad arterial roads, flyovers, metro lines, and rain waterlogging choke points.
2. An autonomous tool 'get_live_traffic_flow' connected to TomTom real-time traffic speed and congestion sensors.

Guidelines:
- ALWAYS call the 'get_live_traffic_flow' tool if the user is asking about current traffic, rush hour route viability, or comparing routes right now.
- Provide crisp, highly actionable commute advice: mention specific flyover ramps, underpasses, metro lines, and time-saving detours.
- Format responses cleanly with bold headings, bullet points, and estimated travel times.
- Context retrieved from Hyderabad Urban Knowledge Base:
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

      // Return tool output to Gemini
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
    }

    const finalResponseText = result.response.text();

    return {
      response: finalResponseText,
      ragSources,
      liveTelemetry: capturedTelemetry,
    };
  } catch (err) {
    console.error("Agent execution error:", err);
    // Graceful fallback with RAG and Telemetry
    const matched = matchJunction(userQuery);
    capturedTelemetry = await fetchLiveTraffic(
      matched.coordinates.lat,
      matched.coordinates.lng,
      matched.name,
      matched.id
    );

    return {
      response: `### 🚦 Commute Advisory (${matched.name})
- **Current Flow:** ${capturedTelemetry.currentSpeedKmph} km/h (${capturedTelemetry.congestionStatus}, ~${capturedTelemetry.delayMinutes}m delay)
- **Top Detour:** ${matched.alternateRoutes[0]}
- **Metro Option:** ${matched.publicTransit}`,
      ragSources,
      liveTelemetry: capturedTelemetry,
    };
  }
}
