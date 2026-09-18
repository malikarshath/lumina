import type { Source } from "@/lib/askStream";

export function SourcesPanel({ sources }: { sources: Source[] }) {
  return (
    <div className="collapse collapse-arrow border border-neutral-800 bg-neutral-900">
      <input type="checkbox" defaultChecked />
      <div className="collapse-title text-sm font-medium text-neutral-200">
        Sources
        {sources.length > 0 && <span className="badge badge-sm ml-2 bg-neutral-700 text-neutral-200">{sources.length}</span>}
      </div>
      <div className="collapse-content">
        {sources.length === 0 ? (
          <p className="text-sm text-neutral-500">No sources yet.</p>
        ) : (
          <ol className="space-y-3 text-sm">
            {sources.map((s) => (
              <li key={s.n}>
                <span className="text-neutral-500">[{s.n}]</span>{" "}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="link link-primary">
                    {s.title}
                  </a>
                ) : (
                  <span className="text-neutral-200">📄 {s.title}</span>
                )}
                {s.snippet && <p className="mt-0.5 text-xs text-neutral-500">{s.snippet.slice(0, 160)}…</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
