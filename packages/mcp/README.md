# @comic-builder/mcp

MCP server (stdio) for comic-builder projects. It lets an external agent (Claude Code, OpenClaw, any MCP client) read and edit projects, lay out chapters from scenes, preview pages and export, without opening the app.

The agent's own model does the script breakdown: the server only exposes deterministic operations on `@comic-builder/core`. It does **not** generate artwork.

## Run

```sh
pnpm build
node packages/mcp/dist/main.js --root /path/to/comics
```

Roots are the only folders the server can touch: `--root <dir>` (repeatable) or `COMIC_BUILDER_ROOTS` (separated by `;` on Windows, `:` elsewhere). Without roots, the server refuses to start.

### Claude Code

```sh
claude mcp add comic-builder -- node /abs/path/comic-builder/packages/mcp/dist/main.js --root /path/to/comics
```

### Other clients (OpenClaw, Claude Desktop, …)

Any client that launches stdio servers:

```json
{
  "mcpServers": {
    "comic-builder": {
      "command": "node",
      "args": ["/abs/path/comic-builder/packages/mcp/dist/main.js", "--root", "/path/to/comics"]
    }
  }
}
```

To debug: `npx @modelcontextprotocol/inspector node packages/mcp/dist/main.js --root <dir>`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_projects`, `open_project`, `create_project` | Find, select or create a project under the roots |
| `get_project`, `get_chapter`, `get_page`, `get_script`, `get_sheet` | Read |
| `validate` | Structural validation and lint of a page or chapter |
| `set_script` | Replace a chapter's script |
| `layout_chapter` | Build a chapter's pages from scenes and beats (like the app's breakdown) |
| `apply_commands` | Editor commands (panels, balloons, characters, chapters…), all or none |
| `preview_page` | A page as PNG, to look at |
| `export_chapter` | Export a chapter's targets (PNG pages, strip, CBZ…) to `exports/<chapter>/` |

## Concurrency with the app

The server does not keep projects open. Reads always load from disk. Each write takes the project lock (`.comic-lock`) only while it loads, applies and saves, then releases it. While the project is open in the app, the app holds the lock and the server refuses to write; reads still work.

Before saving, every changed document is checked against its schema, so the server never writes a file the app would refuse to open.

## Limits

- No image generation (that is phase 2: it needs the generation pipeline and the spend cap out of the UI).
- Rasterization uses resvg, so JPEG targets are written as PNG (the result says so).
- Lettering uses the app's font (Comic Neue).
