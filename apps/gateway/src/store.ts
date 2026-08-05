/**
 * Gateway catalogue, backed by `@kairos/catalog`.
 *
 * In-memory by default (ephemeral, as before); set `CATALOG_STORE_FILE` to a
 * JSON path and the catalogue survives restarts. Types are re-exported so the
 * rest of the gateway imports them from here, unchanged.
 */

export type { Skill, Workflow, McpServer, ActivityItem, CatalogStore } from "@kairos/catalog";

import { createCatalogStore, type CatalogStore } from "@kairos/catalog";

const file = process.env.CATALOG_STORE_FILE?.trim();

export const store: CatalogStore = createCatalogStore(file ? { file } : {});

// Flush on exit so a restarted gateway keeps the catalogue it had.
process.on("SIGINT", () => store.flush());
process.on("SIGTERM", () => store.flush());
