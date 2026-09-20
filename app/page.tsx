"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChatMessage, LiveTrafficTelemetry } from "@/lib/types";
import { TrafficTelemetryCard } from "@/components/TrafficTelemetryCard";
import { RagCitationBadge } from "@/components/RagCitationBadge";
import { PromptSuggestions } from "@/components/PromptSuggestions";
import {
  Send,
  Navigation,
  Bot,
  User,
  RotateCcw,
  Sparkles,
  Car,
  Activity,
  MapPin,
  Clock,
  Layers,
} from "lucide-react";

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "**Namaskaram! I am your Hyderabad Transit AI Specialist.**\n\nI combine local route intelligence across 25+ Hyderabad arterial corridors with real-time TomTom sensor telemetry. Ask me about live choke points, flyover vs underpass decisions, monsoon waterlogging risks, or fastest commute routes right now.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Maintain live IST clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // Debounce ref: prevents double-submit on rapid clicks or Enter key spam
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Rate-limit: tracks last submit timestamp — enforces min 3s gap between requests
  const lastSubmitRef = useRef<number>(0);

  const handleSubmit = (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    // Rate-limit guard: silently block if last request was < 3 seconds ago
    const now = Date.now();
    if (now - lastSubmitRef.current < 3000) return;

    // Debounce: cancel any pending fire and wait 300ms before executing
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      lastSubmitRef.current = Date.now();
      setInput("");
      const userMsg: ChatMessage = { role: "user", content: query };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: query,
            history: messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const data: {
          response: string;
          ragSources: string[];
          liveTelemetry: LiveTrafficTelemetry | null;
        } = await res.json();

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            telemetry: data.liveTelemetry,
            ragSources: data.ragSources,
          },
        ]);
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "⚠️ **Connection Issue:** Unable to complete traffic query. Please check your network connection or verify API credentials.",
          },
        ]);
      } finally {
        setLoading(false);
      }
    }, 300);
  };

  const handleClear = () => {
    setMessages([
      {
        role: "assistant",
        content:
          "Conversation reset. Ready for your next Hyderabad transit or route query!",
      },
    ]);
  };

  // Quick formatter for simple markdown rendering
  const renderFormattedContent = (content: string) => {
    return content.split("\n").map((line, idx) => {
      // High-visibility Decision Card for Yashika's Suggestion
      if (line.includes("🎯") || line.toLowerCase().includes("yashika's suggestion")) {
        const cleanText = line.replace(/🎯|\*\*Yashika's Suggestion:\*\*|Yashika's Suggestion:/gi, "").trim();
        return (
          <div
            key={idx}
            className="my-3 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-amber-500/10 p-3.5 shadow-sm"
          >
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <span>Yashika&apos;s Commute Recommendation</span>
            </div>
            <p className="mt-1.5 text-sm font-semibold leading-relaxed text-slate-900 dark:text-slate-100">
              {parseBold(cleanText)}
            </p>
          </div>
        );
      }

      if (line.startsWith("### ")) {
        return (
          <h3 key={idx} className="mt-3 mb-1 text-base font-bold text-indigo-600 dark:text-indigo-400">
            {line.replace("### ", "")}
          </h3>
        );
      }
      if (line.startsWith("#### ")) {
        return (
          <h4 key={idx} className="mt-2 mb-1 text-sm font-semibold text-slate-800 dark:text-slate-200">
            {line.replace("#### ", "")}
          </h4>
        );
      }
      if (line.startsWith("* ") || line.startsWith("- ")) {
        const itemText = line.substring(2);
        return (
          <li key={idx} className="ml-4 list-disc text-sm text-slate-700 dark:text-slate-300">
            {parseBold(itemText)}
          </li>
        );
      }
      if (line.trim() === "") {
        return <div key={idx} className="h-1.5" />;
      }
      return (
        <p key={idx} className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          {parseBold(line)}
        </p>
      );
    });
  };

  const parseBold = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-slate-900 dark:text-slate-100">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-500/20">
              <Navigation className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                  Hyderabad Transit AI
                </h1>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  RAG + Agent
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Real-Time Urban Mobility & Route Intelligence
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-800/60 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400">
              <Clock className="h-3.5 w-3.5 text-indigo-500" />
              <span>IST: {currentTime || "--:--:--"}</span>
            </div>

            <button
              onClick={handleClear}
              title="Reset conversation"
              className="rounded-lg border border-slate-200 dark:border-slate-800 p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Corridor Banner */}
      <section className="border-b border-slate-200/60 dark:border-slate-800/60 bg-slate-100/50 dark:bg-slate-900/40 px-4 py-2 text-xs">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 text-rose-500" />
            <span className="font-medium">Active Transit Corridors:</span>
            <span className="hidden sm:inline">HITEC City • Gachibowli ORR • Cable Bridge • Ameerpet • PVNR Expressway • Airport Link</span>
            <span className="sm:hidden">25+ Monitored Junctions</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
            <span>Telemetry Live</span>
          </div>
        </div>
      </section>

      {/* Main Chat Feed */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="flex-1 space-y-4">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex gap-3 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role === "assistant" && (
                <div className="mt-1 flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                  <Bot className="h-4 w-4" />
                </div>
              )}

              <div
                className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white rounded-br-none"
                    : "border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-bl-none text-slate-800 dark:text-slate-200"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                ) : (
                  <div>
                    {renderFormattedContent(msg.content)}

                    {/* Render live telemetry card if the agent invoked the live traffic sensor */}
                    {msg.telemetry && (
                      <TrafficTelemetryCard telemetry={msg.telemetry} />
                    )}

                    {/* Render RAG retrieval citation sources */}
                    {msg.ragSources && msg.ragSources.length > 0 && (
                      <RagCitationBadge sources={msg.ragSources} />
                    )}
                  </div>
                )}
              </div>

              {msg.role === "user" && (
                <div className="mt-1 flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          ))}

          {/* Loading indicator */}
          {loading && (
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white">
                <Bot className="h-4 w-4" />
              </div>
              <div className="rounded-2xl rounded-bl-none border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-bounce" />
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-bounce [animation-delay:0.2s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-bounce [animation-delay:0.4s]" />
                  </div>
                  <span>Synthesizing RAG knowledge & fetching live TomTom telemetry...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Floating suggestion chips */}
        {messages.length <= 3 && !loading && (
          <div className="my-4 pt-2 border-t border-slate-200/60 dark:border-slate-800/60">
            <PromptSuggestions
              onSelectPrompt={(p) => handleSubmit(p)}
              disabled={loading}
            />
          </div>
        )}

        {/* Input Bar */}
        <div className="sticky bottom-4 z-20 mt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
            className="relative flex items-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-lg shadow-slate-200/50 dark:shadow-slate-950/50"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about live traffic, bottlenecks, or alternate routes in Hyderabad..."
              disabled={loading}
              className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white transition-all hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 shadow-md shadow-indigo-600/20"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>

          <p className="mt-2 text-center text-[11px] text-slate-600 dark:text-slate-400">
            Powered by Google Gemini 1.5 Flash Agent • TomTom Traffic Flow API • Vector Cosine Similarity
          </p>
        </div>
      </main>
    </div>
  );
}
