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
  name: string;
  url: string;
  status: "connected" | "disconnected";
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
    const server: McpServer = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name ?? "Untitled server",
      url: input.url ?? "",
      status: input.status ?? "disconnected",
    };
    mcpServers.set(server.id, server);
    note("mcp.registered", server.name);
    return server;
  },

  seedSkills(): Skill[] {
    [
      { name: "Market data", description: "Metered price feed", priceWei: "1500", vendor: "acme", egress: ["api.acme.dev"] },
      { name: "Sentiment", description: "Text sentiment scoring", priceWei: "800", vendor: "beta", egress: ["api.beta.ai"] },
      { name: "Geocoding", description: "Address to coordinates", priceWei: "400", vendor: "atlas", egress: ["api.atlas.io"] },
    ].forEach((s) => store.publishSkill(s));
    return store.skills();
  },

  seedWorkflows(): Workflow[] {
    store.saveWorkflow({
      name: "Branch demo",
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
