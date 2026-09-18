export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8787";
export const USER_ID = "malik"; // no auth in LUMINA; identity is this header

const auth = { "X-User-Id": USER_ID };

export type DocInfo = {
  docId: string;
  title: string;
  status: string;
  pct?: number;
  error?: string;
};

export async function createSpace(name = "My Documents"): Promise<{ spaceId: string; name: string }> {
  const r = await fetch(`${GATEWAY_URL}/spaces`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return r.json();
}

export async function uploadDoc(spaceId: string, file: File): Promise<{ docId: string; status: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${GATEWAY_URL}/spaces/${spaceId}/documents`, {
    method: "POST",
    headers: auth, // note: no Content-Type — the browser sets the multipart boundary
    body: fd,
  });
  return r.json();
}

export async function listDocs(spaceId: string): Promise<DocInfo[]> {
  const r = await fetch(`${GATEWAY_URL}/spaces/${spaceId}/documents`, { headers: auth });
  const j = await r.json();
  return j.documents ?? [];
}

export type ArtifactStatus = {
  status: "pending" | "ready" | "failed";
  url?: string;
  outline?: unknown;
  promptUsed?: string;
  model?: string;
  costUsd?: number;
  error?: string;
};

// The ask loop never calls this -- artifacts are a separate, deliberate,
// cost-bearing action the user takes on an answer that already exists.
export async function createArtifact(
  kind: "deck" | "image",
  threadId: string,
  answerId?: string,
  prompt?: string,
): Promise<{ artifactId: string; kind: string; status: string } | { error: string; resetsAt?: string }> {
  const r = await fetch(`${GATEWAY_URL}/artifacts`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ kind, threadId, answerId, prompt }),
  });
  return r.json();
}

export async function getArtifact(artifactId: string): Promise<ArtifactStatus> {
  const r = await fetch(`${GATEWAY_URL}/artifacts/${artifactId}`, { headers: auth });
  return r.json();
}
