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
