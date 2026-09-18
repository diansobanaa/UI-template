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

  const handleValidate = async () => {
    try {
      setIsValid(null);
      setValidationErrors([]);
      const parsed = JSON.parse(draft);
      const res = await esp32Client.validateConfiguration(parsed);
      // The ESP32 returns { data: { valid: boolean, errors: [] } }
      // But the TS signature might expect res directly
      const valid = (res as any).valid;
      const errors = (res as any).errors || [];
      setIsValid(valid);
      setValidationErrors(errors);
    } catch (e: any) {
      setIsValid(false);
      setValidationErrors([e.message || "Invalid JSON"]);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(draft);
      await esp32Client.saveConfiguration(parsed);
      alert("Configuration saved successfully");
    } catch (e: any) {
      alert("Failed to save configuration: " + (e.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8">Loading configuration...</div>;

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
            <div className="flex gap-4 mt-4">
              <button
                onClick={handleValidate}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Validate Draft
              </button>
              <button
                onClick={handleSave}
                disabled={saving || isValid === false}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:text-slate-400 text-white rounded-lg font-medium transition-colors"
              >
                {saving ? "Saving..." : "Deploy Configuration"}
              </button>
            </div>
          </div>
        </div>

        <div className="col-span-1 space-y-6">
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
