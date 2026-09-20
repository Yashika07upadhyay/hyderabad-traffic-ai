import { NextRequest, NextResponse } from "next/server";
import { runTransitAgent } from "@/lib/gemini-agent";

// Hyderabad traffic-relevant keyword whitelist
const TRAFFIC_KEYWORDS = [
  // Areas / landmarks
  "amb", "dlf", "cyber", "towers", "mindspace", "raidurg", "gachibowli",
  "financial", "district", "kondapur", "madhapur", "hitec", "htech",
  "ameerpet", "punjagutta", "pvnr", "orr", "airport", "shamshabad",
  "jubilee", "hills", "durgam", "cheruvu", "kothaguda", "botanical",
  "inorbit", "sarath", "wipro", "iiit", "isb", "nanakramguda", "kphb",
  "jntu", "miyapur", "secunderabad", "begumpet", "mehdipatnam",
  "tolichowki", "shaikpet", "banjara", "raidurg", "kukatpally",
  // Transit / traffic intent words
  "traffic", "route", "road", "drive", "commute", "travel", "reach",
  "go", "from", "to", "via", "speed", "slow", "jam", "congestion",
  "flyover", "bypass", "signal", "junction", "highway", "expressway",
  "fast", "quick", "how long", "how much time", "best way", "which way",
  "live", "current", "now", "today", "tonight", "morning", "evening",
  "peak", "rush", "delay", "mins", "minutes", "km", "kilometre",
  "waterlog", "rain", "flood", "metro", "cab", "auto", "uber", "ola",
];

// Minimum number of matching keywords to accept the query
const MIN_KEYWORD_MATCHES = 1;

function isTrafficRelatedQuery(query: string): boolean {
  const q = query.toLowerCase();

  // Reject very short or purely social queries
  if (q.length < 5) return false;

  // Reject explicit social/greeting patterns
  const socialPatterns = [
    /^(hi|hello|hey|hii+|helo|hai)[^a-z]*$/i,
    /^how are you/i,
    /^good (morning|afternoon|evening|night)/i,
    /^what('s| is) up/i,
    /^(thanks|thank you|ok|okay|sure|great|nice|cool|awesome|wow)[^a-z]*$/i,
    /^who are you/i,
    /^what (can|do) you do/i,
    /^(bye|goodbye|see you)[^a-z]*$/i,
    /^(yes|no|maybe|ok+)[^a-z]*$/i,
    /^\?+$/,
  ];
  if (socialPatterns.some((p) => p.test(q.trim()))) return false;

  // Accept if it contains at least one traffic-related keyword
  const matchCount = TRAFFIC_KEYWORDS.filter((kw) => q.includes(kw)).length;
  return matchCount >= MIN_KEYWORD_MATCHES;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history } = body;

    // --- Basic validation ---
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Query message is required." },
        { status: 400 }
      );
    }

    const trimmed = message.trim();

    // --- Length guard: reject too-short or too-long inputs ---
    if (trimmed.length < 5) {
      return NextResponse.json({
        response:
          "Please type a Hyderabad traffic or route query — for example: *'AMB to DLF'* or *'How is traffic at Cyber Towers right now?'*",
        ragSources: [],
        liveTelemetry: null,
      });
    }

    if (trimmed.length > 400) {
      return NextResponse.json({
        response:
          "Your query is too long. Please keep it under 400 characters and focus on a specific route or junction in Hyderabad.",
        ragSources: [],
        liveTelemetry: null,
      });
    }

    // --- Domain guard: reject non-traffic queries ---
    if (!isTrafficRelatedQuery(trimmed)) {
      return NextResponse.json({
        response:
          "I'm a Hyderabad traffic specialist — I can only help with road conditions, commute routes, junction status, and travel time estimates. Try asking something like:\n\n* *'Cyber Towers to Mindspace right now?'*\n* *'How is traffic from AMB to DLF?'*\n* *'Is the PVNR Expressway clear at this time?'*",
        ragSources: [],
        liveTelemetry: null,
      });
    }

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
