"use client";

import React from "react";
import { AlertTriangle, XCircle, WifiOff, ArrowRight } from "lucide-react";

export interface FertigationAlert {
  id: string;
  tone: "red" | "amber";
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function FertigationAlerts({ alerts }: { alerts: FertigationAlert[] }) {
  if (alerts.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`flex items-start gap-3 rounded-2xl border p-4 ${
            alert.tone === "red"
              ? "border-red-500/30 bg-red-500/10"
              : "border-amber-500/30 bg-amber-500/10"
          }`}
        >
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              alert.tone === "red"
                ? "bg-red-500/20 text-red-400"
                : "bg-amber-500/20 text-amber-400"
            }`}
          >
            {alert.tone === "red" ? (
              <XCircle className="h-4 w-4" />
            ) : (
              <AlertTriangle className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div
              className={`font-semibold ${
                alert.tone === "red" ? "text-red-200" : "text-amber-200"
              }`}
            >
              {alert.title}
            </div>
            <div
              className={`mt-0.5 text-sm ${
                alert.tone === "red" ? "text-red-300/70" : "text-amber-300/70"
              }`}
            >
              {alert.message}
            </div>
          </div>
          {alert.actionLabel && alert.onAction && (
            <button
              type="button"
              onClick={alert.onAction}
              className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                alert.tone === "red"
                  ? "bg-red-500/20 text-red-200 hover:bg-red-500/30"
                  : "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
              }`}
            >
              {alert.actionLabel}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
