import { NextRequest, NextResponse } from "next/server";
import { runTransitAgent } from "@/lib/gemini-agent";

// The 5 active corridors currently maintained in our database
const SUPPORTED_CORRIDORS = [
  {
    id: "amb-to-dlf",
    name: "AMB Cinemas to DLF Cyber City (Kondapur / Gachibowli)",
    places: ["amb", "sarath city", "dlf", "kothaguda", "botanical"],
  },
  {
    id: "cyber-to-mindspace",
    name: "Cyber Towers to Mindspace & Raidurg (Madhapur / HITEC City)",
    places: ["cyber towers", "cyber gateway", "mindspace", "raidurg", "hitec", "madhapur", "shilparamam"],
  },
  {
    id: "financial-to-dlf",
    name: "Financial District to DLF Cyber City (Wipro Circle / Gachibowli)",
    places: ["financial district", "waverock", "wipro circle", "nanakramguda", "isb"],
  },
  {
    id: "gachibowli-to-airport",
    name: "Gachibowli to RGI Airport (ORR Expressway)",
    places: ["airport", "shamshabad", "rgia", "orr", "outer ring road", "pvnr"],
  },
  {
    id: "durgam-cheruvu-bridge",
    name: "Durgam Cheruvu Cable Bridge to Jubilee Hills",
    places: ["durgam cheruvu", "cable bridge", "jubilee hills", "road 45", "road 36"],
  },
];

// Major Hyderabad areas that exist geographically but are NOT currently in our 5-corridor sensor mesh
const UNMONITORED_HYD_AREAS = [
  "secunderabad", "begumpet", "ameerpet", "punjagutta", "kphb", "jntu", "miyapur",
  "mehdipatnam", "tolichowki", "shaikpet", "banjara hills", "kukatpally", "charminar",
  "uppal", "lb nagar", "dilsukhnagar", "tarnaka", "malakpet", "abids", "koti", "alwal",
  "kompally", "ecil", "malkajgiri", "old city", "nampally", "khairatabad", "paradise"
];

// Non-traffic topics (tourism, food, tech, general trivia, jailbreaks)
const NON_TRAFFIC_INTENTS = [
  "famous spot", "tourist spot", "food", "restaurant", "places to visit", "place to visit",
  "eating", "biryani", "timing", "ticket", "movie", "show", "job", "hiring", "company",
  "companies", "shopping", "store", "mall", "cafe", "pub", "hotel", "flat", "rent",
  "house", "pg", "hostel", "node", "javascript", "python", "code", "promise", "async",
  "recipe", "who is", "weather", "temperature", "president", "math", "joke", "story",
  "poem", "sightseeing", "attractions", "attraction"
];

// Traffic/commute intent keywords
const TRAFFIC_INTENT_KEYWORDS = [
  "traffic", "jam", "congestion", "choke", "speed", "slow", "delay", "travel time",
  "how long", "condition", "status", "road", "drive", "commute", "flyover", "reach",
  "which way", "clear", "stuck", "bottleneck", "rush", "peak", "fastest", "route",
  "waterlog", "waterlogging", "bypass", "underpass", "time", "take"
];

interface ValidationResult {
  isValid: boolean;
  corridorId?: string;
  rejectionMessage?: string;
}

function validateAndClassifyQuery(
  rawQuery: string,
  history: { role: string; content: string }[] = []
): ValidationResult {
  const q = rawQuery.trim().toLowerCase();

  // 1. Minimum and Maximum length checks
  if (q.length < 3) {
    return {
      isValid: false,
      rejectionMessage: "Please enter a specific Hyderabad traffic or route query.",
    };
  }
  if (q.length > 400) {
    return {
      isValid: false,
      rejectionMessage: "Query too long. Please keep questions under 400 characters.",
    };
  }

  // 2. Greetings and Pleasantries check
  const socialOnly = /^(hi|hello|hey|hii+|helo|hai|good morning|good evening|how are you|what's up|thanks|thank you|ok|okay|bye|cool|great)[\s!.]*$/i;
  if (socialOnly.test(q)) {
    return {
      isValid: false,
      rejectionMessage:
        "Namaskaram! I am your Hyderabad Transit AI specialist. Ask me about live traffic conditions or routes for our supported corridors:\n\n* *'AMB to DLF'* \n* *'Traffic at Cyber Towers right now'* \n* *'Financial District to DLF: Wipro Circle vs ORR?'*",
    };
  }

  // 3. Non-traffic topic detection (e.g. 'famous spots in DLF', 'restaurants in Hitec City')
  for (const nonTrafficWord of NON_TRAFFIC_INTENTS) {
    if (q.includes(nonTrafficWord)) {
      const placeMentioned = SUPPORTED_CORRIDORS.flatMap((c) => c.places).find((p) => q.includes(p));
      const targetPlace = placeMentioned ? placeMentioned.toUpperCase() : "this area";
      return {
        isValid: false,
        rejectionMessage: `ℹ️ **Non-Transit Query Intercepted:**\nI am exclusively a real-time **traffic, road condition, and commute routing AI**. I do not provide tourist spots, restaurant recommendations, shopping info, or general trivia for ${targetPlace}.\n\n👉 **Allowed query examples:**\n* *'Traffic in ${targetPlace}'*\n* *'${targetPlace} to DLF'*`,
      };
    }
  }

  // 4. Unmonitored area detection (e.g. 'secunderabad traffic', 'kphb traffic')
  for (const unmonitoredArea of UNMONITORED_HYD_AREAS) {
    if (q.includes(unmonitoredArea)) {
      const formattedArea = unmonitoredArea.charAt(0).toUpperCase() + unmonitoredArea.slice(1);
      return {
        isValid: false,
        rejectionMessage: `⚠️ **Corridor Not Monitored:**\nOur real-time sensor network currently monitors **5 West Hyderabad transit corridors only**. **${formattedArea}** is outside our active sensor network.\n\n📍 **Monitored corridors currently in our database:**\n1. **AMB Cinemas ➔ DLF Cyber City** (Kondapur / Gachibowli)\n2. **Cyber Towers ➔ Mindspace & Raidurg** (Madhapur / HITEC City)\n3. **Financial District ➔ DLF Cyber City** (Wipro Circle / Gachibowli)\n4. **Gachibowli ➔ RGI Airport** (ORR Expressway)\n5. **Durgam Cheruvu Cable Bridge ➔ Jubilee Hills**\n\nPlease select one of the supported corridors above.`,
      };
    }
  }

  // 5. Match against our 5 supported corridors
  let matchedCorridor = null;
  for (const corridor of SUPPORTED_CORRIDORS) {
    const hasPlace = corridor.places.some((p) => q.includes(p));
    if (hasPlace) {
      matchedCorridor = corridor;
      break;
    }
  }

  // Check for traffic intent or route patterns
  const hasRoutePattern = /\b[a-z0-9\s]+\s+to\s+[a-z0-9\s]+\b/i.test(q);
  const hasTrafficWord = TRAFFIC_INTENT_KEYWORDS.some((t) => q.includes(t));

  // If matched a supported corridor AND has traffic intent or route pattern -> APPROVED
  if (matchedCorridor && (hasRoutePattern || hasTrafficWord || q.split(/\s+/).length <= 4)) {
    return {
      isValid: true,
      corridorId: matchedCorridor.id,
    };
  }

  // 6. Conversational follow-up (in ongoing conversation with history)
  if (history.length > 0 && (hasTrafficWord || q.includes("sunday") || q.includes("rain") || q.includes("delay"))) {
    return {
      isValid: true,
    };
  }

  // 7. General fallback refusal
  return {
    isValid: false,
    rejectionMessage: `I can only answer real-time traffic queries for our monitored Hyderabad corridors.\n\n👉 **Try asking:**\n* *'AMB to DLF Cyber City'* \n* *'Traffic at Cyber Towers right now'* \n* *'Financial District to DLF: which route is faster?'*`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Query message is required." },
        { status: 400 }
      );
    }

    const trimmed = message.trim();
    const validation = validateAndClassifyQuery(trimmed, history || []);

    // If blocked, return immediately without invoking Gemini or TomTom APIs!
    if (!validation.isValid) {
      return NextResponse.json({
        response: validation.rejectionMessage,
        ragSources: [],
        liveTelemetry: null,
      });
    }

    // Call agent with validated query and corridor
    const result = await runTransitAgent(trimmed, history || [], validation.corridorId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        error: "Internal server error occurred while processing transit query.",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
