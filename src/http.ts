import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { URL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createProcoreMcpServer, loadEnv } from "./create-server.js";

loadEnv();

const PORT = Number(process.env.PROCORE_MCP_PORT || "9220");
const BIND = process.env.PROCORE_MCP_BIND || "0.0.0.0";
const MCP_PATH = process.env.PROCORE_MCP_PATH || "/mcp";
const AUTH_TOKEN = (process.env.PROCORE_MCP_TOKEN || "").trim();

const transports: Record<string, StreamableHTTPServerTransport> = {};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, {
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}

function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization || "";
  if (header === `Bearer ${AUTH_TOKEN}`) return true;
  unauthorized(res);
  return false;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown
): Promise<void> {
  if (!checkAuth(req, res)) return;

  const sessionIdHeader = req.headers["mcp-session-id"];
  const sessionId =
    typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;

  try {
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(parsedBody)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.error(`Procore MCP session initialized: ${sid}`);
          if (transport) transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport?.sessionId;
        if (sid && transports[sid]) {
          delete transports[sid];
          console.error(`Procore MCP session closed: ${sid}`);
        }
      };
      const { server } = await createProcoreMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, parsedBody);
      return;
    } else {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    console.error("Procore MCP HTTP error:", error);
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

async function route(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  const path = url.pathname;

  if (path === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (path !== MCP_PATH) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    await handleMcp(req, res, body);
    return;
  }

  if (req.method === "GET" || req.method === "DELETE") {
    await handleMcp(req, res);
    return;
  }

  res.writeHead(405, { "Content-Type": "text/plain" });
  res.end("method not allowed");
}

const server = createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error("Unhandled HTTP error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("internal server error");
    }
  });
});

server.listen(PORT, BIND, () => {
  console.error(
    `Procore MCP Streamable HTTP listening on http://${BIND}:${PORT}${MCP_PATH}` +
      (AUTH_TOKEN ? " (bearer auth enabled)" : "")
  );
});

async function shutdown(): Promise<void> {
  for (const sessionId of Object.keys(transports)) {
    try {
      await transports[sessionId].close();
    } catch (error) {
      console.error(`Error closing session ${sessionId}:`, error);
    }
    delete transports[sessionId];
  }
  server.close();
}

process.on("SIGINT", () => {
  shutdown()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  shutdown()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
