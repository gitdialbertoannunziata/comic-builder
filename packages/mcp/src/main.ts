#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseRoots } from "./roots.js";
import { createServer } from "./server.js";

// stdout è il canale del protocollo: ogni messaggio per chi legge va su stderr.
try {
  const roots = parseRoots(process.argv.slice(2), process.env);
  const server = createServer(roots);
  await server.connect(new StdioServerTransport());
  console.error(`comic-builder MCP server ready · roots: ${roots.join(", ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
