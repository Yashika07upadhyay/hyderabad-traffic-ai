import React from "react";
import { BookOpen, Database } from "lucide-react";

interface Props {
  sources: string[];
}

export const RagCitationBadge: React.FC<Props> = ({ sources }) => {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
      <span className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-400">
        <Database className="h-3 w-3 text-indigo-500" />
        RAG Knowledge Citations:
      </span>
      {sources.map((src, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-md bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/60"
        >
          <BookOpen className="h-2.5 w-2.5" />
          {src}
        </span>
      ))}
    </div>
  );
};
