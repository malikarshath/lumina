"use client";

import { useState } from "react";
import { askStream, type Source } from "@/lib/askStream";

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";
const USER_ID = "malik"; // no auth in LUMINA; identity is just this header

export default function Home() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [trace, setTrace] = useState<{ tool: string; ok: boolean; ms: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setAnswer("");
    setSources([]);
    setTrace([]);
    setError(null);

    await askStream(GATEWAY, "t1", query, "web", USER_ID, {
      onTrace: (d) => setTrace((t) => [...t, { tool: d.tool, ok: d.ok, ms: d.ms }]),
      onSources: (s) => setSources(s),
      onToken: (text) => setAnswer((a) => a + text),
      onDone: () => setLoading(false),
      onError: (d) => {
        setError(d.error ?? "Something went wrong");
        setLoading(false);
      },
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">LUMINA</h1>
      <p className="mb-8 mt-1 text-neutral-400">
        Ask anything — get a cited answer from the live web.
      </p>

      <form onSubmit={onAsk} className="mb-6 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you want to know?"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 outline-none focus:border-neutral-400"
        />
        <button
          disabled={loading}
          className="rounded-lg bg-white px-5 py-2 font-medium text-black disabled:opacity-50"
        >
          {loading ? "…" : "Ask"}
        </button>
      </form>

      {trace.length > 0 && (
        <div className="mb-4 space-y-1 text-sm text-neutral-500">
          {trace.map((t, i) => (
            <div key={i}>
              🔍 {t.tool} {t.ok ? "✓" : "✗"} · {t.ms}ms
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950 p-3 text-red-200">
          {error}
        </div>
      )}

      {answer && (
        <div className="mb-8 whitespace-pre-wrap leading-relaxed">{answer}</div>
      )}

      {sources.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">
            Sources
          </h2>
          <ol className="space-y-3">
            {sources.map((s) => (
              <li key={s.n} className="text-sm">
                <span className="text-neutral-500">[{s.n}]</span>{" "}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  {s.title}
                </a>
                {s.snippet && (
                  <p className="mt-0.5 text-neutral-500">
                    {s.snippet.slice(0, 160)}…
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
