import { NextRequest, NextResponse } from "next/server";
import { runTransitAgent } from "@/lib/gemini-agent";

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

    const result = await runTransitAgent(message, history || []);

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
