import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools/registry.js";
import { registerAutoTools } from "./tools/auto-register.js";
import { loadCatalog, loadCategories } from "./catalog/repository.js";
import { tokensExist } from "./auth/token-store.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")
    );
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Load `.env` from project root when keys are not already set. */
export function loadEnv(): void {
  const envPath = join(__dirname, "..", "..", ".env");
  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // rely on process env
  }
}

export function validateProcoreRuntime(): void {
  const clientId = process.env.PROCORE_CLIENT_ID;
  const clientSecret = process.env.PROCORE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "PROCORE_CLIENT_ID and PROCORE_CLIENT_SECRET are required in .env or environment."
    );
  }
  if (!tokensExist()) {
    throw new Error(
      "No Procore auth tokens found. Run OAuth setup on the office host first."
    );
  }
}

export function preloadCatalog(): void {
  const catalog = loadCatalog();
  const categories = loadCategories();
  console.error(
    `Catalog loaded: ${catalog.length} endpoints, ${Object.keys(categories.categories).length} categories`
  );
}

export async function createProcoreMcpServer(): Promise<{
  server: McpServer;
  toolCount: number;
}> {
  loadEnv();
  validateProcoreRuntime();
  preloadCatalog();

  const server = new McpServer({
    name: "procore",
    version: packageVersion(),
  });

  registerTools(server);

  let autoCount = 0;
  if ((process.env.PROCORE_TOOL_MODE || "meta").toLowerCase() === "all") {
    autoCount = registerAutoTools(server);
    console.error(`Auto-registered ${autoCount} endpoint tools`);
  } else {
    console.error(
      "Serving the 7 discovery tools; every Procore endpoint stays reachable " +
        "through procore_api_call. Set PROCORE_TOOL_MODE=all to also register " +
        "a dedicated tool per endpoint."
    );
  }

  return { server, toolCount: autoCount + 7 };
}
