"use client";

import { useEffect, useState } from "react";
import { esp32Client } from "@/lib/api/esp32-client";
import { ConfigurationPayload } from "@/lib/api/contracts";

export default function ConfigurationPage() {
  const [config, setConfig] = useState<ConfigurationPayload | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [validationErrors, setValidationErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    esp32Client.getConfiguration()
      .then((cfg) => {
        setConfig(cfg);
        // The API actually returns { data: { payload: ConfigurationPayload, ... } }
        // Wait, looking at api_config_handlers.c, it returns { data: { version, hash, config: { ... } } }
        // Let's just stringify whatever the client gets.
        setDraft(JSON.stringify(cfg, null, 2));
      })
      .catch((err) => {
        console.error("Failed to load config", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const [stagedVersion, setStagedVersion] = useState<number | null>(null);
  const [committing, setCommitting] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  const handleValidate = async () => {
    try {
      setIsValid(null);
      setValidationErrors([]);
      const parsed = JSON.parse(draft);
      const res = await esp32Client.validateConfiguration(parsed);
      const valid = (res as any).valid;
      const errors = (res as any).errors || [];
      setIsValid(valid);
      setValidationErrors(errors);
    } catch (e: any) {
      setIsValid(false);
      setValidationErrors([e.message || "Invalid JSON"]);
    }
  };

  const handleStage = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(draft);
      await esp32Client.saveConfiguration(parsed);
      // In M4, saving stages the config instead of activating it
      const cfgObj = (config as any)?.config || (config as any);
      setStagedVersion((cfgObj?.version || 0) + 1);
      alert("Configuration staged successfully. Review and commit to activate.");
    } catch (e: any) {
      alert("Failed to stage configuration: " + (e.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleCommit = async () => {
    if (stagedVersion === null) return;
    try {
      setCommitting(true);
      await esp32Client.commitConfiguration(stagedVersion);
      alert("Configuration activated successfully!");
      setStagedVersion(null);
      window.location.reload(); // Reload to fetch active config
    } catch (e: any) {
      alert("Failed to commit: " + (e.message || String(e)));
    } finally {
      setCommitting(false);
    }
  };

  const handleRollback = async () => {
    if (!confirm("Are you sure you want to rollback to the previous active configuration?")) return;
    try {
      setRollingBack(true);
      await esp32Client.rollbackConfiguration();
      alert("Rolled back successfully!");
      setStagedVersion(null);
      window.location.reload(); // Reload to fetch reverted config
    } catch (e: any) {
      alert("Failed to rollback: " + (e.message || String(e)));
    } finally {
      setRollingBack(false);
    }
  };

  if (loading) return <div className="p-8 text-white">Loading configuration...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-white">Configuration Editor</h1>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <div className="bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700">
            <h2 className="text-xl font-semibold mb-4 text-slate-200">Active Draft (JSON)</h2>
            <textarea
              className="w-full h-[600px] bg-slate-900 text-green-400 p-4 font-mono text-sm rounded border border-slate-700 focus:outline-none focus:border-green-500 transition-colors"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            <div className="flex gap-4 mt-4 items-center">
              <button
                onClick={handleValidate}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Validate Draft
              </button>
              <button
                onClick={handleStage}
                disabled={saving || isValid === false}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:text-slate-400 text-white rounded-lg font-medium transition-colors"
              >
                {saving ? "Staging..." : "Stage Configuration"}
              </button>
              
              {stagedVersion !== null && (
                <button
                  onClick={handleCommit}
                  disabled={committing}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-600 text-white rounded-lg font-medium shadow-[0_0_15px_rgba(79,70,229,0.5)] transition-colors animate-pulse"
                >
                  {committing ? "Committing..." : "Commit Activation"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="col-span-1 space-y-6">
          <div className="bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700">
            <h2 className="text-lg font-semibold mb-2 text-slate-200">Deployment Status</h2>
            
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${stagedVersion ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.6)]' : 'bg-slate-500'}`}></span>
                <span className="text-sm font-medium text-slate-300">
                  {stagedVersion ? `Staged v${stagedVersion} (Pending Commit)` : "No Active Stage"}
                </span>
              </div>
              
              <div className="pt-2 border-t border-slate-700">
                <button
                  onClick={handleRollback}
                  disabled={rollingBack}
                  className="w-full px-4 py-2 bg-slate-700 hover:bg-red-900 text-red-300 hover:text-red-100 disabled:opacity-50 rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                  {rollingBack ? "Rolling back..." : "Rollback to Previous"}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700">
            <h2 className="text-lg font-semibold mb-2 text-slate-200">Validation Status</h2>
            {isValid === null && (
              <div className="text-slate-400 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-slate-500"></span>
                Not validated
              </div>
            )}
            {isValid === true && (
              <div className="text-green-400 flex items-center gap-2 font-medium">
                <span className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                Configuration is valid
              </div>
            )}
            {isValid === false && (
              <div className="text-red-400 flex items-center gap-2 font-medium">
                <span className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
                Validation failed
              </div>
            )}
          </div>

          {validationErrors.length > 0 && (
            <div className="bg-slate-800 rounded-xl p-4 shadow-lg border border-red-900/50 bg-red-950/20">
              <h2 className="text-lg font-semibold mb-2 text-red-400">Error Details</h2>
              <ul className="list-disc list-inside space-y-1 text-sm text-red-300">
                {validationErrors.map((err, i) => (
                  <li key={i}>{typeof err === 'string' ? err : err.message || JSON.stringify(err)}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-slate-800 rounded-xl p-4 shadow-lg border border-slate-700">
            <h2 className="text-lg font-semibold mb-2 text-slate-200">System Info</h2>
            <div className="text-sm text-slate-400 space-y-2">
              {/* @ts-ignore */}
              <p>Version: <span className="text-slate-200">{config?.version || "Unknown"}</span></p>
              {/* @ts-ignore */}
              <p>Hash: <span className="font-mono text-slate-200">{config?.hash || "Unknown"}</span></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
