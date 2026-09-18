"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askStream, type Source, type TraceStep } from "@/lib/askStream";
import {
  GATEWAY_URL,
  USER_ID,
  createSpace,
  uploadDoc,
  listDocs,
  createArtifact,
  getArtifact,
  type DocInfo,
} from "@/lib/api";
import { TracePanel } from "@/components/TracePanel";
import { SourcesPanel } from "@/components/SourcesPanel";

type Mode = "auto" | "web" | "docs" | "deep";
type ArtifactUi = { kind: "deck" | "image"; status: "pending" | "ready" | "failed"; url?: string; error?: string };

// One fixed thread for this single-thread UI. Must match the contract's
// ThreadId shape (thr_...) -- POST /threads/:id/ask never validated its URL
// param, so a plain "t1" silently worked for asking but broke the moment
// POST /artifacts (which does validate threadId) tried to use the same id.
const THREAD_ID = "thr_web01";

export default function Home() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocInfo[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const [answerId, setAnswerId] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<ArtifactUi | null>(null);

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
    setAnswerId(null);
    setArtifact(null);

    const sid = mode === "web" || mode === "deep" ? undefined : spaceId ?? undefined;
    await askStream(GATEWAY_URL, THREAD_ID, query, mode, USER_ID, {
      onTrace: (d) => setTrace((t) => [...t, d]),
      onSources: (s) => setSources(s),
      onToken: (text) => setAnswer((a) => a + text),
      onDone: (d) => {
        setLoading(false);
        setAnswerId(d.answerId);
      },
      onError: (d) => {
        setError(d.error ?? "Something went wrong");
        setLoading(false);
      },
    }, sid);
  }

  // Deck/image generation: a separate, deliberate, cost-bearing action on an
  // answer that already exists -- never something the ask loop spends on
  // itself. 202 -> poll -> ready/failed, same pattern as document upload.
  async function makeArtifact(kind: "deck" | "image") {
    if (!answerId) return;
    setArtifact({ kind, status: "pending" });
    const created = await createArtifact(kind, THREAD_ID, answerId);
    if ("error" in created) {
      setArtifact({ kind, status: "failed", error: created.error });
      return;
    }
    for (let i = 0; i < 30; i++) {
      const a = await getArtifact(created.artifactId);
      if (a.status === "ready") {
        setArtifact({ kind, status: "ready", url: `${GATEWAY_URL}${a.url}` });
        return;
      }
      if (a.status === "failed") {
        setArtifact({ kind, status: "failed", error: a.error ?? "generation failed" });
        return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setArtifact({ kind, status: "failed", error: "timed out waiting for the artifact" });
  }

  const modes: Mode[] = ["auto", "web", "docs", "deep"];

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-bold">LUMINA</h1>
      <p className="mb-6 mt-1 text-neutral-400">
        Ask anything — cited answers from the live web and your documents.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* ---- main chat column ---- */}
        <div>
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
          {mode === "deep" && (
            <p className="mb-3 text-xs text-neutral-500">
              Plans sub-questions, researches each in parallel, and merges citations — slower, broader.
            </p>
          )}

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
          {mode !== "web" && mode !== "deep" && (
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

          {error && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950 p-3 text-red-200">{error}</div>
          )}

          {answer && (
            <div className="prose prose-invert prose-sm mb-4 max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
            </div>
          )}

          {answerId && !loading && (
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => makeArtifact("deck")}
                disabled={artifact?.status === "pending"}
                className="rounded-md bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-50"
              >
                📊 Make a deck
              </button>
              <button
                onClick={() => makeArtifact("image")}
                disabled={artifact?.status === "pending"}
                className="rounded-md bg-neutral-800 px-3 py-1 text-sm hover:bg-neutral-700 disabled:opacity-50"
              >
                🎨 Generate image
              </button>
            </div>
          )}

          {artifact && (
            <div className="mb-8 rounded-lg border border-neutral-800 p-3 text-sm">
              {artifact.status === "pending" && (
                <span className="text-neutral-400">Generating your {artifact.kind}…</span>
              )}
              {artifact.status === "failed" && (
                <span className="text-red-400">Failed: {artifact.error}</span>
              )}
              {artifact.status === "ready" && artifact.kind === "deck" && (
                <a href={artifact.url} className="text-blue-400 hover:underline">
                  ⬇️ Download deck (.pptx)
                </a>
              )}
              {artifact.status === "ready" && artifact.kind === "image" && artifact.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artifact.url} alt="Generated illustration" className="max-w-xs rounded-md" />
              )}
            </div>
          )}
        </div>

        {/* ---- right sidebar: collapsible Trace + Sources ---- */}
        <aside className="space-y-3 lg:sticky lg:top-12 lg:self-start">
          <TracePanel trace={trace} />
          <SourcesPanel sources={sources} />
        </aside>
      </div>
    </main>
  );
}
