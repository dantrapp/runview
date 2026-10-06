import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { serve } from "../src/cli/server.ts";

it("serves only static files inside the root with a restrictive content policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "runview-serve-")),
    outside = mkdtempSync(join(tmpdir(), "runview-private-"));
  writeFileSync(join(root, "index.html"), "<main>Runview</main>");
  writeFileSync(join(outside, "secret.txt"), "private");
  symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
  const server = await serve(root, 0);
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    expect(address.address).toBe("127.0.0.1");
    const url = `http://127.0.0.1:${address.port}`;
    const response = await fetch(url);
    expect(await response.text()).toBe("<main>Runview</main>");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "connect-src 'none'",
    );
    expect((await fetch(`${url}/escape.txt`)).status).toBe(403);
    expect((await fetch(`${url}/..%2fprivate`)).status).toBe(404);
    expect((await fetch(url, { method: "POST" })).status).toBe(405);
    expect(await (await fetch(url, { method: "HEAD" })).text()).toBe("");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
