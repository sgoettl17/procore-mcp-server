import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProcoreMcpServer } from "./create-server.js";

async function main(): Promise<void> {
  try {
    const { server, toolCount } = await createProcoreMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`Procore MCP server running — ${toolCount} total tools`);
  } catch (err) {
    console.error("ERROR:", (err as Error).message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
