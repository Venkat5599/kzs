import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @kairos/catalog — the gateway's catalogue, optionally persistent.
 *
 * The confidential path is the product; the catalogue exists so the dashboard
 * has something to render. It was in-process and lost on restart; this service
 * keeps the same interface and adds an optional JSON-file backing so the VPS
 * can survive a redeploy without the dashboard emptying.
 *
 * Persistence is honest about what it is: a debounced atomic file write, not a
 * database. Concurrent multi-process writers are out of scope — one gateway
 * process owns the file.
 */

export interface Skill {
  slug: string;
  name: string;
  description: string;
  priceWei: string;
  vendor: string;
  egress: string[];
  createdAt: string;
}

export interface Workflow {
  slug: string;
  name: string;
  graph: unknown;
  createdAt: string;
}

export interface McpServer {
  id: string;
  slug: string;
  name: string;
  url: string;
  status: "connected" | "disconnected";
  tools: string[];
  workflows: string[];
}

export interface ActivityItem {
  id: string;
  kind: string;
  detail: string;
  at: string;
}

export interface CatalogState {
  skills: Skill[];
  workflows: Workflow[];
  mcpServers: McpServer[];
  activity: ActivityItem[];
  runs: unknown[];
}

export interface CatalogStore {
  skills(): Skill[];
  skill(slug: string): Skill | undefined;
  workflows(): Workflow[];
  mcpServers(): McpServer[];
  runs(): unknown[];
  activity(): ActivityItem[];

  publishSkill(input: Partial<Skill> & { name?: string }): Skill;
  saveWorkflow(input: Partial<Workflow> & { name?: string }): Workflow;
  saveMcpServer(input: Partial<McpServer> & { name?: string }): McpServer;
  updateMcpServer(slugOrId: string, patch: Partial<Pick<McpServer, "tools" | "workflows" | "status" | "name" | "url">>): McpServer | null;
  /** Append a workflow run record (bounded, newest first). */
  recordRun(run: unknown): void;
  seedSkills(): Skill[];
  seedWorkflows(): Workflow[];
  note(kind: string, detail: string): void;
  /** Persist now (used by tests and shutdown hooks). */
  flush(): void;
}

export interface CatalogOptions {
  /** JSON file to persist to. Omit for a purely in-memory store. */
  file?: string;
}

const now = () => new Date().toISOString();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function createCatalogStore(options: CatalogOptions = {}): CatalogStore {
  const file = options.file;
  let skills = new Map<string, Skill>();
  let workflows = new Map<string, Workflow>();
  let mcpServers = new Map<string, McpServer>();
  let activity: ActivityItem[] = [];
  let runs: unknown[] = [];

  if (file && existsSync(file)) {
    try {
      const state = JSON.parse(readFileSync(file, "utf8")) as CatalogState;
      skills = new Map(state.skills.map((s) => [s.slug, s]));
      workflows = new Map(state.workflows.map((w) => [w.slug, w]));
      mcpServers = new Map(state.mcpServers.map((m) => [m.id, m]));
      activity = state.activity ?? [];
      runs = state.runs ?? [];
    } catch (e) {
      // A corrupt catalogue file must not take the gateway down at boot. The
      // store starts empty; the next mutation overwrites the bad file.
      console.error(`catalog: could not load ${file}, starting empty:`, e instanceof Error ? e.message : e);
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleFlush(): void {
    if (!file) return;
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      writeNow();
    }, 50);
  }

  function writeNow(): void {
    if (!file) return;
    const state: CatalogState = {
      skills: [...skills.values()],
      workflows: [...workflows.values()],
      mcpServers: [...mcpServers.values()],
      activity,
      runs,
    };
    const tmp = `${file}.tmp`;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    // Atomic on the same filesystem: readers never see a half-written file.
    renameSync(tmp, file);
  }

  function note(kind: string, detail: string): void {
    activity.unshift({ id: crypto.randomUUID(), kind, detail, at: now() });
    if (activity.length > 100) activity.pop();
    scheduleFlush();
  }

  return {
    skills: () => [...skills.values()],
    skill: (slug: string) => skills.get(slug),
    workflows: () => [...workflows.values()],
    mcpServers: () => [...mcpServers.values()],
    runs: () => runs,
    activity: () => activity,
    note,

    publishSkill(input: Partial<Skill> & { name?: string }): Skill {
      const name = input.name ?? "Untitled skill";
      const skill: Skill = {
        slug: input.slug ?? slugify(name),
        name,
        description: input.description ?? "",
        priceWei: input.priceWei ?? "1000",
        vendor: input.vendor ?? "unknown",
        egress: input.egress ?? [],
        createdAt: now(),
      };
      skills.set(skill.slug, skill);
      note("skill.published", skill.name);
      return skill;
    },

    saveWorkflow(input: Partial<Workflow> & { name?: string }): Workflow {
      const name = input.name ?? "Untitled workflow";
      const wf: Workflow = {
        slug: input.slug ?? slugify(name),
        name,
        graph: input.graph ?? { nodes: [], edges: [] },
        createdAt: now(),
      };
      workflows.set(wf.slug, wf);
      note("workflow.saved", wf.name);
      return wf;
    },

    saveMcpServer(input: Partial<McpServer> & { name?: string }): McpServer {
      const name = input.name ?? "Untitled server";
      const server: McpServer = {
        id: input.id ?? crypto.randomUUID(),
        slug: input.slug ?? slugify(name),
        name,
        url: input.url ?? "",
        status: input.status ?? "disconnected",
        tools: input.tools ?? [],
        workflows: input.workflows ?? [],
      };
      mcpServers.set(server.id, server);
      note("mcp.registered", server.name);
      return server;
    },

    updateMcpServer(slugOrId: string, patch: Partial<Pick<McpServer, "tools" | "workflows" | "status" | "name" | "url">>): McpServer | null {
      const server = mcpServers.get(slugOrId) ?? [...mcpServers.values()].find((s) => s.slug === slugOrId);
      if (!server) return null;
      const next: McpServer = { ...server, ...patch };
      mcpServers.set(next.id, next);
      note("mcp.updated", next.name);
      return next;
    },

    recordRun(run: unknown): void {
      runs.unshift(run);
      if (runs.length > 100) runs.pop();
      scheduleFlush();
    },

    seedSkills(): Skill[] {
      [
        { name: "Sample — Market data", description: "Example listing. Metered price feed.", priceWei: "1500", vendor: "sample-vendor", egress: ["api.example.dev"] },
        { name: "Sample — Sentiment", description: "Example listing. Text sentiment scoring.", priceWei: "800", vendor: "sample-vendor", egress: ["api.example.ai"] },
        { name: "Sample — Geocoding", description: "Example listing. Address to coordinates.", priceWei: "400", vendor: "sample-vendor", egress: ["api.example.io"] },
      ].forEach((s) => this.publishSkill(s));
      return this.skills();
    },

    seedWorkflows(): Workflow[] {
      this.saveWorkflow({
        name: "Sample — branch demo",
        graph: {
          nodes: [
            { id: "start", kind: "trigger" },
            { id: "gate", kind: "condition" },
            { id: "cheap", kind: "http" },
            { id: "pricey", kind: "onchain" },
            { id: "receipt", kind: "transform" },
          ],
          edges: [
            { from: "start", to: "gate" },
            { from: "gate", to: "cheap", branch: "true" },
            { from: "gate", to: "pricey", branch: "false" },
            { from: "cheap", to: "receipt" },
            { from: "pricey", to: "receipt" },
          ],
        },
      });
      return this.workflows();
    },

    flush: writeNow,
  };
}
