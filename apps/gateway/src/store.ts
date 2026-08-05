/**
 * In-process catalogue.
 *
 * The confidential path is the product; this exists so the dashboard has
 * something to render for skills, workflows and MCP servers. It is explicitly
 * ephemeral — restart and it is empty again — rather than pretending to be a
 * database. `services/catalog` is where this goes when it needs to persist.
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
  /** Stable handle the dashboard addresses a server by. */
  slug: string;
  name: string;
  url: string;
  status: "connected" | "disconnected";
  /** Built-in and API-proxy tools this server exposes to an agent. */
  tools: string[];
  /** Workflow slugs this server exposes. */
  workflows: string[];
}

export interface ActivityItem {
  id: string;
  kind: string;
  detail: string;
  at: string;
}

const skills = new Map<string, Skill>();
const workflows = new Map<string, Workflow>();
const mcpServers = new Map<string, McpServer>();
const activity: ActivityItem[] = [];
const runs: unknown[] = [];

const now = () => new Date().toISOString();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function note(kind: string, detail: string): void {
  activity.unshift({ id: crypto.randomUUID(), kind, detail, at: now() });
  if (activity.length > 100) activity.pop();
}

export const store = {
  skills: () => [...skills.values()],
  skill: (slug: string) => skills.get(slug),
  workflows: () => [...workflows.values()],
  mcpServers: () => [...mcpServers.values()],
  runs: () => runs,
  activity: () => activity,

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

  /**
   * Change which tools and workflows a server exposes.
   *
   * Addressed by slug or id, because the dashboard holds the slug while the map
   * is keyed by id. Returns `null` for an unknown server so the route can answer
   * 404 rather than silently creating one.
   */
  updateMcpServer(
    slugOrId: string,
    patch: Partial<Pick<McpServer, "tools" | "workflows" | "status" | "name" | "url">>,
  ): McpServer | null {
    const server =
      mcpServers.get(slugOrId) ?? [...mcpServers.values()].find((s) => s.slug === slugOrId);
    if (!server) return null;

    const next: McpServer = { ...server, ...patch };
    mcpServers.set(next.id, next);
    note("mcp.updated", next.name);
    return next;
  },

  /**
   * Populate the catalogue with obviously-fictional entries.
   *
   * These exist so the marketplace has something to render on a fresh gateway.
   * Every name is prefixed and every vendor is invented, because a catalogue row
   * that could be mistaken for a real integration would misrepresent the
   * product: the confidential settlement path is real, this listing is not.
   */
  seedSkills(): Skill[] {
    [
      { name: "Sample — Market data", description: "Example listing. Metered price feed.", priceWei: "1500", vendor: "sample-vendor", egress: ["api.example.dev"] },
      { name: "Sample — Sentiment", description: "Example listing. Text sentiment scoring.", priceWei: "800", vendor: "sample-vendor", egress: ["api.example.ai"] },
      { name: "Sample — Geocoding", description: "Example listing. Address to coordinates.", priceWei: "400", vendor: "sample-vendor", egress: ["api.example.io"] },
    ].forEach((s) => store.publishSkill(s));
    return store.skills();
  },

  seedWorkflows(): Workflow[] {
    store.saveWorkflow({
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
    return store.workflows();
  },
};
