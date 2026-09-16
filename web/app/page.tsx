"use client";

import { useEffect, useRef, useState } from "react";
import { askStream, type Source } from "@/lib/askStream";
import { GATEWAY_URL, USER_ID, createSpace, uploadDoc, listDocs, type DocInfo } from "@/lib/api";

type Mode = "auto" | "web" | "docs";

export default function Home() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [trace, setTrace] = useState<{ tool: string; ok: boolean; ms: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Restore the space from localStorage; refresh its document list.
  useEffect(() => {
    const s = localStorage.getItem("lumina_space");
    if (s) {
      setSpaceId(s);
      listDocs(s).then(setDocs).catch(() => {});
    }
  }, []);

  async function ensureSpace(): Promise<string> {
    if (spaceId) return spaceId;
    const { spaceId: id } = await createSpace();
    localStorage.setItem("lumina_space", id);
    setSpaceId(id);
    return id;
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const id = await ensureSpace();
    await uploadDoc(id, file);
    if (fileRef.current) fileRef.current.value = "";
    // Poll until the worker finishes indexing.
    for (let i = 0; i < 20; i++) {
      const d = await listDocs(id);
      setDocs(d);
      if (d.every((x) => x.status === "indexed" || x.status === "failed")) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setAnswer("");
    setSources([]);
    setTrace([]);
    setError(null);

    const sid = mode === "web" ? undefined : spaceId ?? undefined;
    await askStream(GATEWAY_URL, "t1", query, mode, USER_ID, {
      onTrace: (d) => setTrace((t) => [...t, { tool: d.tool, ok: d.ok, ms: d.ms }]),
      onSources: (s) => setSources(s),
      onToken: (text) => setAnswer((a) => a + text),
      onDone: () => setLoading(false),
      onError: (d) => {
        setError(d.error ?? "Something went wrong");
        setLoading(false);
      },
    }, sid);
  }

  const modes: Mode[] = ["auto", "web", "docs"];

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">LUMINA</h1>
      <p className="mb-6 mt-1 text-neutral-400">
        Ask anything — cited answers from the live web and your documents.
      </p>

      {/* mode toggle */}
      <div className="mb-3 flex gap-1 text-sm">
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "rounded-md px-3 py-1 capitalize " +
              (mode === m ? "bg-white text-black" : "bg-neutral-900 text-neutral-400 hover:text-neutral-200")
            }
          >
            {m}
          </button>
        ))}
      </div>

      <form onSubmit={onAsk} className="mb-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you want to know?"
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 outline-none focus:border-neutral-400"
        />
        <button disabled={loading} className="rounded-lg bg-white px-5 py-2 font-medium text-black disabled:opacity-50">
          {loading ? "…" : "Ask"}
        </button>
      </form>

      {/* documents panel (used when mode is docs or auto) */}
      {mode !== "web" && (
        <div className="mb-6 rounded-lg border border-neutral-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-neutral-500">Your documents</span>
            <label className="cursor-pointer rounded-md bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700">
              + Upload
              <input ref={fileRef} type="file" accept=".txt,.md,.pdf" onChange={onUpload} className="hidden" />
            </label>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-neutral-600">No documents yet. Upload a .txt, .md, or .pdf to search it.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {docs.map((d) => (
                <li key={d.docId} className="flex justify-between">
                  <span className="truncate pr-4">{d.title}</span>
                  <span className={d.status === "indexed" ? "text-green-400" : d.status === "failed" ? "text-red-400" : "text-neutral-500"}>
                    {d.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {trace.length > 0 && (
        <div className="mb-4 space-y-1 text-sm text-neutral-500">
          {trace.map((t, i) => (
            <div key={i}>🔍 {t.tool} {t.ok ? "✓" : "✗"} · {t.ms}ms</div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-800 bg-red-950 p-3 text-red-200">{error}</div>
      )}

      {answer && <div className="mb-8 whitespace-pre-wrap leading-relaxed">{answer}</div>}

      {sources.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs uppercase tracking-widest text-neutral-500">Sources</h2>
          <ol className="space-y-3">
            {sources.map((s) => (
              <li key={s.n} className="text-sm">
                <span className="text-neutral-500">[{s.n}]</span>{" "}
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                    {s.title}
                  </a>
                ) : (
                  <span className="text-neutral-200">📄 {s.title}</span>
                )}
                {s.snippet && <p className="mt-0.5 text-neutral-500">{s.snippet.slice(0, 160)}…</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
