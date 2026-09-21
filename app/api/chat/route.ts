import { NextRequest, NextResponse } from "next/server";
import { runTransitAgent } from "@/lib/gemini-agent";

// Explicit non-transit / jailbreak patterns (tech, coding, trivia, general chat)
const OUT_OF_DOMAIN_PATTERNS = [
  // Programming & tech
  /\b(node|nodejs|javascript|js|typescript|ts|python|java|c\+\+|golang|rust|html|css|react|nextjs)\b/i,
  /\b(promise|promises|async|await|callback|function|array|object|class|method|loop|variable)\b/i,
  /\b(code|coding|program|programming|debug|debugger|compiler|syntax|algorithm|github|git|api key)\b/i,
  /\b(sql|database|postgres|mongodb|redis|prisma|orm|query|backend|frontend|fullstack)\b/i,
  // General trivia & creative writing
  /\b(recipe|cook|bake|movie|song|lyrics|poem|story|joke|riddle|essay|homework)\b/i,
  /\b(president|prime minister|capital of|who invented|history of|math|solve|calculate)\b/i,
  /\b(weather|temperature|forecast|rain today in delhi|mumbai|bangalore)\b/i,
  // Jailbreak attempts
  /ignore (all |previous |prior )?instructions/i,
  /you are now (an? |a general )/i,
  /pretend (you are|to be)/i,
];

// Specific Hyderabad geographic landmarks and corridors
const HYD_LOCATIONS = [
  "amb", "sarath city", "dlf", "cyber towers", "cyber gateway", "mindspace", "raidurg",
  "gachibowli", "financial district", "nanakramguda", "wipro circle", "kothaguda",
  "botanical garden", "durgam cheruvu", "cable bridge", "jubilee hills", "road 45",
  "road 36", "hitec", "hitech", "madhapur", "kondapur", "pvnr", "orr", "outer ring road",
  "airport", "shamshabad", "rgia", "ameerpet", "punjagutta", "kphb", "jntu", "miyapur",
  "secunderabad", "begumpet", "mehdipatnam", "tolichowki", "shaikpet", "banjara hills",
  "kukatpally", "inorbit", "knowledge city", "t-hub", "shilparamam", "attapur"
];

// Specific transit-intent words (must indicate movement, road conditions, or transit)
const TRANSIT_INTENT_WORDS = [
  "traffic", "commute", "congestion", "jam", "choke point", "flyover", "underpass",
  "route", "road", "drive", "travel time", "delay", "waterlog", "waterlogging",
  "toll", "signal", "bottleneck", "detour", "bypass", "expressway", "speed limit",
  "reach", "how to go", "which way", "how long will it take", "alternate route"
];

function isTrafficRelatedQuery(
  query: string,
  history: { role: string; content: string }[] = []
): { isValid: boolean; reason?: string } {
  const q = query.trim().toLowerCase();

  // 1. Length bounds
  if (q.length < 3) {
    return { isValid: false, reason: "Please enter a specific Hyderabad route or junction query." };
  }
  if (q.length > 400) {
    return { isValid: false, reason: "Your query is too long. Please keep it under 400 characters." };
  }

  // 2. Pure greetings & pleasantries
  const socialOnly = /^(hi|hello|hey|hii+|helo|hai|good morning|good evening|how are you|what's up|thanks|thank you|ok|okay|bye|cool|great)[\s!.]*$/i;
  if (socialOnly.test(q)) {
    return {
      isValid: false,
      reason:
        "Namaste! I am your Hyderabad Transit AI specialist. Ask me about live commute routes, flyover traffic, or travel times across Hyderabad — e.g. *'AMB to DLF'* or *'Cyber Towers to Mindspace right now.'*",
    };
  }

  // 3. Strict out-of-domain check (programming, trivia, jailbreak attempts)
  for (const pattern of OUT_OF_DOMAIN_PATTERNS) {
    if (pattern.test(q)) {
      return {
        isValid: false,
        reason:
          "I specialize exclusively in **Hyderabad transit routing, live road traffic, and commute advisory**. I cannot assist with programming, general technical queries, or non-transit topics.\n\nPlease ask a Hyderabad route query, for example:\n* *'AMB Cinemas to DLF Cyber City right now'* \n* *'Cyber Towers to Mindspace: flyover or bypass?'*\n* *'Financial District to DLF: Wipro Circle vs ORR?'*",
      };
    }
  }

  // 4. Check for known Hyderabad landmarks
  const hasHydLocation = HYD_LOCATIONS.some((loc) => q.includes(loc));

  // 5. Check for transit intent terms
  const hasTransitIntent = TRANSIT_INTENT_WORDS.some((word) => q.includes(word));

  // 6. Direct route pattern check: e.g. "from [x] to [y]" or "[x] to [y]"
  const hasRoutePattern = /\b(from\s+[a-z0-9\s]+to\s+[a-z0-9\s]+|[a-z0-9\s]+\s+to\s+[a-z0-9\s]+)\b/i.test(q);

  // 7. Contextual follow-up check: If user asks a short follow-up in an ongoing conversation
  const isConversationalFollowUp =
    history.length > 0 &&
    (q.includes("sunday") ||
      q.includes("rain") ||
      q.includes("flyover") ||
      q.includes("time") ||
      q.includes("why") ||
      q.includes("alternate") ||
      q.includes("how long") ||
      q.includes("faster") ||
      q.includes("metro"));

  if (hasHydLocation || (hasTransitIntent && (hasRoutePattern || isConversationalFollowUp)) || isConversationalFollowUp) {
    return { isValid: true };
  }

  // If none matched, reject with clear guidance
  return {
    isValid: false,
    reason:
      "I am a specialized Hyderabad Transit AI. I can only assist with road conditions, choke points, and route optimization between Hyderabad areas.\n\nTry asking:\n* *'AMB to DLF Cyber City'* \n* *'Cyber Towers to Mindspace live traffic'* \n* *'Financial District to DLF: which route is faster?'*",
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
    const validation = isTrafficRelatedQuery(trimmed, history || []);

    // Intercept out-of-domain, non-traffic, or jailbreak queries immediately
    if (!validation.isValid) {
      return NextResponse.json({
        response: validation.reason,
        ragSources: [],
        liveTelemetry: null,
      });
    }

    // Pass valid query and conversation history to the agent
    const result = await runTransitAgent(trimmed, history || []);
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
