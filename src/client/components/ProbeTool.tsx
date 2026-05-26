import { useState } from "react";
import type { ProbeResponse } from "../../shared/api";
import { api } from "../api";
import { Badge } from "../ui";
import { DnaPanel } from "./DnaPanel";

/**
 * "Test a phrase" against the team's institutional memory. Type any content and
 * see the Decision DNA the team would surface for it — the fastest way to feel
 * how Memex thinks, and a one-click demo of the precedent engine.
 */
export function ProbeTool({ probes }: { probes: string[] }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ProbeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async (value: string) => {
    const q = value.trim();
    if (!q || loading) return;
    setText(value);
    setLoading(true);
    try {
      setResult(await api.probe(q));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/30 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Test a phrase</h2>
        {result?.semanticEnabled && <Badge tone="emerald">semantic on</Badge>}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run(text)}
          placeholder="Paste content to see the team's Decision DNA..."
          className="flex-1 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2.5 text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-orange-500/60"
        />
        <button
          onClick={() => run(text)}
          disabled={loading || !text.trim()}
          className="rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-500 disabled:opacity-40"
        >
          {loading ? "..." : "Analyze"}
        </button>
      </div>

      {probes.length > 0 && !result && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-slate-500">Try:</span>
          {probes.map((p, i) => (
            <button
              key={i}
              onClick={() => run(p)}
              className="rounded-full border border-slate-700 px-2.5 py-0.5 text-[11px] text-slate-400 transition-colors hover:border-orange-500/60 hover:text-orange-300"
            >
              {p.length > 42 ? p.slice(0, 42) + "…" : p}
            </button>
          ))}
        </div>
      )}

      {result && (
        <div className="mt-1">
          <DnaPanel analysis={result.analysis} />
        </div>
      )}
    </section>
  );
}
