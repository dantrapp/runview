import type { Artifact, Bundle } from "./evidence.ts";

export async function decodeArtifact(
  ref: Artifact,
  body: Bundle["artifacts"][number],
): Promise<Uint8Array<ArrayBuffer>> {
  if (body.runId !== ref.runId || body.artifactId !== ref.id)
    throw new Error("Artifact identity mismatch.");
  if (
    body.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)
  )
    throw new Error("Invalid artifact encoding.");
  const decoded = atob(body.base64);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++)
    bytes[index] = decoded.charCodeAt(index);
  if (bytes.byteLength !== ref.byteLength)
    throw new Error("Artifact length mismatch.");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const digest = Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (digest !== body.sha256) throw new Error("Artifact digest mismatch.");
  return bytes;
}
