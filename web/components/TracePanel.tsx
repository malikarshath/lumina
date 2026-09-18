import type { TraceStep } from "@/lib/askStream";

// Best-effort readable label for a tool call's input -- different tools carry
// different fields (query for search and planning, url for fetch_page).
function formatInput(input: unknown): string {
  if (!input || typeof input !== "object") return String(input ?? "");
  const obj = input as Record<string, unknown>;
  if (typeof obj.query === "string") return obj.query;
  if (typeof obj.url === "string") return obj.url;
  return JSON.stringify(obj);
}

export function TracePanel({ trace }: { trace: TraceStep[] }) {
  return (
    <div className="collapse collapse-arrow border border-neutral-800 bg-neutral-900">
      <input type="checkbox" defaultChecked />
      <div className="collapse-title text-sm font-medium text-neutral-200">
        Trace
        {trace.length > 0 && <span className="badge badge-sm ml-2 bg-neutral-700 text-neutral-200">{trace.length}</span>}
      </div>
      <div className="collapse-content">
        {trace.length === 0 ? (
          <p className="text-sm text-neutral-500">No tool calls yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {trace.map((t, i) => (
              <li key={i} className="border-t border-neutral-800 pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-1.5">
                  <span className={t.ok ? "text-green-400" : "text-red-400"}>{t.ok ? "✓" : "✗"}</span>
                  <span className="font-mono text-neutral-200">{t.tool}</span>
                  <span className="text-neutral-500">· {t.ms}ms</span>
                  {/* Which sub-question this step served, so a merged trace is
                      traceable back to the plan rather than being a flat pile. */}
                  {t.subQuestion !== undefined && (
                    <span className="rounded bg-amber-950/60 px-1.5 text-xs text-amber-500/90">
                      Q{t.subQuestion}
                    </span>
                  )}
                </div>
                {formatInput(t.input) && (
                  <div className="mt-0.5 truncate text-xs text-neutral-500" title={formatInput(t.input)}>
                    {formatInput(t.input)}
                  </div>
                )}
                {t.error && <div className="mt-0.5 text-xs text-red-400">{t.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
