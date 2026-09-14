import React from "react";
import { Compass, Sparkles } from "lucide-react";

interface Props {
  onSelectPrompt: (prompt: string) => void;
  disabled?: boolean;
}

const SUGGESTIONS = [
  "Cyber Towers to Mindspace right now: Flyover or Durgam Cheruvu cable bridge?",
  "How is traffic from Gachibowli to RGI Airport? Should I take PVNR Expressway or ORR?",
  "Is Ameerpet junction jammed right now? What are the best detours?",
  "Heading from Kondapur to Financial District during peak rain, any waterlogging?",
  "Check live traffic status and speed on Durgam Cheruvu Bridge.",
];

export const PromptSuggestions: React.FC<Props> = ({ onSelectPrompt, disabled }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <Sparkles className="h-3.5 w-3.5 text-amber-500" />
        <span>Quick Route Queries</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => onSelectPrompt(prompt)}
            disabled={disabled}
            className="group flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 transition-all hover:border-indigo-500/50 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-50"
          >
            <Compass className="h-3 w-3 text-slate-400 group-hover:text-indigo-500" />
            <span>{prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
