import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createCatalogStore } from "../src/index.js";

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kairos-catalog-"));
  file = join(dir, "catalog.json");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("catalog store", () => {
  it("starts empty", () => {
    const s = createCatalogStore();
    expect(s.skills()).toEqual([]);
    expect(s.workflows()).toEqual([]);
  });

  it("publishes and updates rows in memory", () => {
    const s = createCatalogStore();
    const skill = s.publishSkill({ name: "Weather", priceWei: "500", egress: ["api.weather.dev"] });
    expect(skill.slug).toBe("weather");
    expect(s.skills()).toHaveLength(1);
    expect(s.activity()[0]!.kind).toBe("skill.published");

    const server = s.saveMcpServer({ name: "Kairos" });
    const updated = s.updateMcpServer(server.id, { tools: ["kairos_pay"] });
    expect(updated!.tools).toEqual(["kairos_pay"]);
    expect(s.updateMcpServer("ghost", {})).toBeNull();
  });

  it("seeds the sample catalogue", () => {
    const s = createCatalogStore();
    expect(s.seedSkills()).toHaveLength(3);
    expect(s.seedWorkflows()).toHaveLength(1);
  });

  it("persists to a file and reloads it", () => {
    const s = createCatalogStore({ file });
    s.publishSkill({ name: "Persistent", priceWei: "123", vendor: "test" });
    s.saveWorkflow({ name: "Persist me" });
    s.note("test.note", "hello");
    s.flush();

    expect(existsSync(file)).toBe(true);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(raw.skills[0].name).toBe("Persistent");

    // A fresh store over the same file sees the data.
    const s2 = createCatalogStore({ file });
    expect(s2.skills().map((x) => x.name)).toContain("Persistent");
    expect(s2.workflows().map((x) => x.name)).toContain("Persist me");
    expect(s2.activity()[0]).toMatchObject({ kind: "test.note", detail: "hello" });
  });

  it("survives a corrupt file by starting empty", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    const s = createCatalogStore({ file: bad });
    expect(s.skills()).toEqual([]);
  });
});
