import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";
import { Workspace } from "./workspace.js";

export const SERVER_INSTRUCTIONS = `comic-builder projects are folders of JSON documents (project, chapters, pages, characters, locations) plus the chapter scripts.
Typical flow: list_projects → open_project → get_project → set_script / layout_chapter (you break the script into scenes and beats) →
apply_commands to adjust panels, balloons and character sheets → validate → preview_page to look at a page → export_chapter.
Writes are refused while the project is open in the comic-builder app: ask the user to close it there.
This server does not generate artwork.`;

/** Il server MCP sulle radici date. Il trasporto lo sceglie chi lo avvia: stdio in `main.ts`, in memoria nei test. */
export function createServer(roots: readonly string[]): McpServer {
  const server = new McpServer({ name: "comic-builder", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, new Workspace(roots));
  return server;
}
