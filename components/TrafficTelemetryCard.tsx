import React from "react";
import { LiveTrafficTelemetry } from "@/lib/types";
import { Activity, AlertTriangle, Clock, Gauge, Navigation, ShieldCheck } from "lucide-react";

interface Props {
  telemetry: LiveTrafficTelemetry;
}

export const TrafficTelemetryCard: React.FC<Props> = ({ telemetry }) => {
  const getStatusColor = (status: LiveTrafficTelemetry["congestionStatus"]) => {
    switch (status) {
      case "Free Flow":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
      case "Moderate Traffic":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
      case "Heavy Congestion":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30";
      case "Severe Gridlock":
        return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/30";
    }
  };

  return (
    <div className="my-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 p-4 shadow-sm backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-indigo-500/10 p-1.5 text-indigo-500">
            <Navigation className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {telemetry.junctionName}
            </h4>
            <p className="text-xs text-slate-500">Live Traffic Flow Telemetry</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${getStatusColor(
              telemetry.congestionStatus
            )}`}
          >
            {telemetry.congestionStatus === "Severe Gridlock" && (
              <AlertTriangle className="h-3 w-3" />
            )}
            {telemetry.congestionStatus}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-400">
            <Clock className="h-3 w-3" />
            {telemetry.timestamp}
          </span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2.5 border border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Gauge className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
            <span>Current Speed</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {telemetry.currentSpeedKmph}
            </span>
            <span className="text-xs text-slate-500">km/h</span>
          </div>
        </div>

        <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2.5 border border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Activity className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
            <span>Free-Flow Target</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {telemetry.freeFlowSpeedKmph}
            </span>
            <span className="text-xs text-slate-500">km/h</span>
          </div>
        </div>

        <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2.5 border border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
            <span>Est. Delay</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span
              className={`text-xl font-bold ${
                telemetry.delayMinutes > 5
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              +{telemetry.delayMinutes}
            </span>
            <span className="text-xs text-slate-500">mins</span>
          </div>
        </div>

        <div className="rounded-lg bg-white/70 dark:bg-slate-800/60 p-2.5 border border-slate-200/60 dark:border-slate-800">
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" />
            <span>Flow Efficiency</span>
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {telemetry.speedRatioPercent}%
            </span>
            <span className="text-xs text-slate-500">of normal</span>
          </div>
        </div>
      </div>

      {/* Speed Efficiency Bar */}
      <div className="mt-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              telemetry.speedRatioPercent < 35
                ? "bg-rose-500"
                : telemetry.speedRatioPercent < 65
                ? "bg-orange-500"
                : telemetry.speedRatioPercent < 85
                ? "bg-amber-500"
                : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(100, Math.max(8, telemetry.speedRatioPercent))}%` }}
          />
        </div>
      </div>

      {/* Sensor Meta */}
      <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          {telemetry.isSimulated
            ? "Simulated Sensor (Live IST Pattern Model)"
            : "TomTom Traffic Flow Segment Sensor API"}
        </span>
        <span>Confidence: {Math.round(telemetry.confidence * 100)}%</span>
      </div>
    </div>
  );
};
