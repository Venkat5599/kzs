import { describe, expect, it } from "bun:test";
import { connect, createKairosClient } from "../src/index.js";

/** A fake fetch that serves the gateway's routes from an in-memory map. */
function fakeGateway(routes: Record<string, unknown>) {
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    const method = (init.method ?? "GET").toUpperCase();
    const key = `${method} ${path}`;
    const entry = routes[key];
    if (entry === undefined) {
      return new Response(JSON.stringify({ error: `no route ${key}` }), { status: 404, headers: { "content-type": "application/json" } });
    }
    if (entry instanceof Error && (entry as unknown as { status?: number }).status) {
      return new Response(JSON.stringify({ error: entry.message }), { status: (entry as unknown as { status: number }).status, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(entry), { status: 200, headers: { "content-type": "application/json" } });
  };
  return fetchFn as typeof fetch;
}

const SKILL = {
  slug: "sample-market-data",
  name: "Sample — Market data",
  description: "Example listing.",
  priceWei: "1500",
  vendor: "sample-vendor",
  egress: ["api.example.dev"],
  createdAt: "2026-08-05T00:00:00.000Z",
};

function client(routes: Record<string, unknown>) {
  return createKairosClient({ baseUrl: "https://gw.example", fetch: fakeGateway(routes) });
}

describe("sdk catalogue", () => {
  it("lists skills", async () => {
    const c = client({ "GET /skills": { skills: [SKILL] } });
    const skills = await c.listSkills();
    expect(skills[0]!.slug).toBe("sample-market-data");
  });

  it("builds a manifest for a skill", async () => {
    const c = client({ "GET /skills/sample-market-data": SKILL });
    const m = await c.manifest("sample-market-data");
    expect(m.pricing.pricePerCall).toBe("1500");
    expect(m.scope.egress).toEqual(["api.example.dev"]);
  });
});

describe("sdk payments", () => {
  it("returns a 402 quote as a normal value", async () => {
    const c = client({
      "POST /s/sample-market-data": Object.assign(new Error("payment required"), { status: 402 }),
      "GET /x402/skills/sample-market-data": { x402Version: 1, error: "payment required", accepts: [] },
    });
    const outcome = await c.invoke("sample-market-data", { city: "Oslo" });
    expect(outcome.status).toBe(402);
  });

  it("maps gateway errors to the shared taxonomy", async () => {
    const c = client({ "GET /skills/nope": Object.assign(new Error("not found"), { status: 404 }) });
    await expect(c.getSkill("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("sdk connect", () => {
  it("confirms reachability", async () => {
    const r = await connect({ baseUrl: "https://gw.example", fetch: fakeGateway({ "GET /health": { ok: true } }) });
    expect(r.ok).toBe(true);
  });

  it("rejects an unhealthy gateway", async () => {
    const bad = fakeGateway({ "GET /health": { ok: false } });
    const r = await connect({ baseUrl: "https://gw.example", fetch: bad });
    expect(r.ok).toBe(false);
  });
});

describe("sdk chain", () => {
  it("exposes the client base url", () => {
    expect(client({}).baseUrl).toBe("https://gw.example");
  });

  it("reports chain status", async () => {
    const c = client({ "GET /chain/status": { configured: true, demoMode: false, network: "testnet", chainId: 11155111, blockNumber: 1, rpcUrl: "rpc", explorer: "exp" } });
    const s = await c.chainStatus();
    expect(s.chainId).toBe(11155111);
  });
});
