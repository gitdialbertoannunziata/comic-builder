import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PROJECT_FILE,
  SceneSchema,
  applyCommand,
  buildPagesFromScene,
  emptyProjectDoc,
  lintPage,
  saveProject,
  validateDocument,
  type Command,
  type ProjectDoc,
} from "@comic-builder/core";
import { sampleProject } from "@comic-builder/core/fixtures";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { exportChapter, previewPage, primaryPageTarget } from "./render.js";
import { within } from "./roots.js";
import type { Workspace } from "./workspace.js";

/** La spaziatura fra le vignette che usa lo spoglio dell'app (`ui/src/runBreakdown.ts`). */
const GUTTER = { x: 14, y: 18 };

const projectParam = {
  project: z
    .string()
    .optional()
    .describe("Project folder (absolute, or relative to a configured root). Defaults to the project chosen with open_project."),
};

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Lo stesso hash che l'app registra per il copione di riferimento delle revisioni. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function summary(dir: string, doc: ProjectDoc) {
  return {
    path: dir,
    id: doc.project.id,
    title: doc.project.title,
    locale: doc.project.locale,
    reading_direction: doc.project.reading_direction,
    primary_target: primaryPageTarget(doc).id,
    targets: doc.project.targets.map((t) => ({ id: t.id, kind: t.kind })),
    style: doc.project.style,
    chapters: doc.chapters.chapters.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      status: c.status,
      pages: c.pages.length,
      has_script: (doc.scripts[c.id] ?? "").trim().length > 0,
    })),
    characters: Object.values(doc.characters).map((c) => ({ ref: c.id, name: c.name })),
    locations: Object.values(doc.locations).map((l) => ({ ref: l.id, name: l.name })),
  };
}

const COMMANDS_HELP = `Each command is an object with a "type" and its fields (ids come from get_project / get_chapter / get_page):
- panel.update {pageId, panelId, patch: {action?, setting?, props?, continuity_notes?, characters?, border?, prompt?, seed?}}
- panel.camera {pageId, panelId, camera: Partial<Camera>}
- panel.merge {pageId, panelIds: [a, b]} · panel.split {pageId, panelId, axis: "cols"|"rows"}
- balloon.text {pageId, balloonId, text: [{t: string}]} · balloon.add {pageId, panelId, text: [{t}], balloonType?} · balloon.remove {pageId, balloonId}
- balloon.update {pageId, balloonId, patch: {type?, font_scale?, speaker?, size_mode?, z?}}
- page.add {chapterId, templateId, sceneId, after?} · page.remove {pageId} · page.move {pageId, toIndex}
- character.upsert {ref, patch: {name?, summary?, appearance?: {...}}} · character.remove {ref} · character.rename {from, to}
- location.upsert {ref, patch: {name?, description?}} · location.remove {ref}
- chapter.add {title} · chapter.update {chapterId, title?, status?} · chapter.move {chapterId, toIndex} · chapter.remove {chapterId}
- project.rename {title} · project.notes {notes} · project.style {positive?: string[], negative?: string[], preset?}
Commands that would leave the document invalid are rejected with a message.`;

export function registerTools(server: McpServer, workspace: Workspace): void {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "Lists the comic-builder projects (folders with a project.json) under the configured roots.",
      annotations: { readOnlyHint: true },
    },
    async () => json(await workspace.listProjects()),
  );

  server.registerTool(
    "open_project",
    {
      title: "Open project",
      description: "Selects the project the other tools work on when `project` is omitted, and returns its summary. Does not lock the project: the app can keep it open.",
      inputSchema: { project: z.string().describe("Project folder (absolute, or relative to a configured root).") },
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => {
      const { dir, loaded } = await workspace.select(project);
      return json({ ...summary(dir, loaded.doc), load_issues: loaded.issues });
    },
  );

  server.registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Creates a new empty project (one empty chapter, default formats and lettering) in a new folder under a configured root, and selects it.",
      inputSchema: {
        folder: z.string().describe("New folder: absolute, or relative to the first configured root. Must not already contain a project."),
        title: z.string().min(1),
      },
    },
    async ({ folder, title }) => {
      const dir = await within(path.isAbsolute(folder) ? folder : path.resolve(workspace.roots[0]!, folder), workspace.roots);
      const exists = await fs.stat(path.join(dir, PROJECT_FILE)).then(() => true, () => false);
      if (exists) throw new Error(`${dir} already contains a project.`);
      const doc = emptyProjectDoc({ ...sampleProject, style: { ...sampleProject.style, positive: [], negative: [] } }, title);
      await saveProject(workspace.store(dir), doc, null);
      const { loaded } = await workspace.select(dir);
      return json(summary(dir, loaded.doc));
    },
  );

  server.registerTool(
    "get_project",
    {
      title: "Get project",
      description: "Project summary: chapters, targets, style, characters and locations.",
      inputSchema: projectParam,
      annotations: { readOnlyHint: true },
    },
    async ({ project }) => {
      const dir = await workspace.locate(project);
      const { doc, issues } = await workspace.read(dir);
      return json({ ...summary(dir, doc), load_issues: issues });
    },
  );

  server.registerTool(
    "get_chapter",
    {
      title: "Get chapter",
      description: "A chapter with its pages (in reading order, with panel and balloon counts) and the scenes they come from.",
      inputSchema: { ...projectParam, chapterId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ project, chapterId }) => {
      const { doc } = await workspace.read(await workspace.locate(project));
      const chapter = doc.chapters.chapters.find((c) => c.id === chapterId);
      if (!chapter) throw new Error(`Unknown chapter: ${chapterId}`);
      const pages = chapter.pages.flatMap((id) => (doc.pages[id] ? [doc.pages[id]] : []));
      const sceneIds = new Set(pages.flatMap((p) => p.panels.map((panel) => panel.scene_id)));
      return json({
        ...chapter,
        pages: pages.map((p) => ({
          id: p.id,
          order: p.order,
          panels: p.panels.map((panel) => ({ id: panel.id, action: panel.action, balloons: panel.balloons.length })),
        })),
        scenes: doc.scenes.scenes.filter((s) => sceneIds.has(s.id)),
      });
    },
  );

  server.registerTool(
    "get_page",
    {
      title: "Get page",
      description: "The full page document (layout, panels, cameras, balloons) as stored in pages/<id>.json.",
      inputSchema: { ...projectParam, pageId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ project, pageId }) => {
      const { doc } = await workspace.read(await workspace.locate(project));
      const page = doc.pages[pageId];
      if (!page) throw new Error(`Unknown page: ${pageId}`);
      return json(page);
    },
  );

  server.registerTool(
    "get_script",
    {
      title: "Get script",
      description: "The chapter's script (Markdown source text).",
      inputSchema: { ...projectParam, chapterId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ project, chapterId }) => {
      const { doc } = await workspace.read(await workspace.locate(project));
      return { content: [{ type: "text", text: doc.scripts[chapterId] ?? "" }] };
    },
  );

  server.registerTool(
    "get_sheet",
    {
      title: "Get character or location sheet",
      description: "A character sheet (appearance, wardrobe, references) or a location sheet, by ref.",
      inputSchema: { ...projectParam, kind: z.enum(["character", "location"]), ref: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ project, kind, ref }) => {
      const { doc } = await workspace.read(await workspace.locate(project));
      const sheet = kind === "character" ? doc.characters[ref] : doc.locations[ref];
      if (!sheet) throw new Error(`Unknown ${kind}: ${ref}`);
      return json(sheet);
    },
  );

  server.registerTool(
    "validate",
    {
      title: "Validate",
      description: "Structural validation and lint (balloon text length, camera rhythm, missing art…) for one page or a whole chapter.",
      inputSchema: { ...projectParam, chapterId: z.string().optional(), pageId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ project, chapterId, pageId }) => {
      const { doc } = await workspace.read(await workspace.locate(project));
      const ids = pageId ? [pageId] : chapterId ? (doc.chapters.chapters.find((c) => c.id === chapterId)?.pages ?? []) : Object.keys(doc.pages);
      const target = primaryPageTarget(doc).id;
      const out = ids.map((id) => {
        const page = doc.pages[id];
        if (!page) return { pageId: id, issues: [{ level: "error", code: "page.missing", message: `Unknown page: ${id}` }] };
        const scene = doc.scenes.scenes.find((s) => s.id === page.panels[0]?.scene_id);
        return { pageId: id, issues: [...validateDocument(page), ...lintPage(page, { target, ...(scene ? { scene } : {}) })] };
      });
      return json(out.filter((p) => p.issues.length > 0));
    },
  );

  server.registerTool(
    "set_script",
    {
      title: "Set script",
      description: "Replaces a chapter's script text. It becomes the reference the revision tracking compares against. Does not re-layout the pages: use layout_chapter for that.",
      inputSchema: { ...projectParam, chapterId: z.string(), text: z.string() },
    },
    async ({ project, chapterId, text }) => {
      const dir = await workspace.locate(project);
      const { saved } = await workspace.mutate(dir, (doc) => {
        if (!doc.chapters.chapters.some((c) => c.id === chapterId)) throw new Error(`Unknown chapter: ${chapterId}`);
        return { next: applyCommand(doc, { type: "script.set", chapterId, text, sha: sha256(text) }), result: null };
      });
      return json({ saved });
    },
  );

  server.registerTool(
    "layout_chapter",
    {
      title: "Lay out chapter from scenes",
      description:
        "Replaces a chapter's pages with pages built from scenes, like the app's script breakdown: you split the script into scenes and beats, " +
        "the layout engine picks templates, cameras and balloons. Scene ids should be `<chapterId>-s<n>`, beat ids unique within the scene; " +
        "character refs should match get_project characters (create new ones with apply_commands character.upsert).",
      inputSchema: {
        ...projectParam,
        chapterId: z.string(),
        scenes: z.array(SceneSchema).min(1),
        script: z.string().optional().describe("The script the scenes come from: stored as the chapter script."),
      },
    },
    async ({ project, chapterId, scenes, script }) => {
      const dir = await workspace.locate(project);
      const { result, saved } = await workspace.mutate(dir, (doc) => {
        const target = primaryPageTarget(doc).id;
        let firstPageNumber = 1;
        const pages = scenes.flatMap((scene) => {
          const built = buildPagesFromScene({ chapterId, scene, firstPageNumber, primaryTarget: target, gutter: GUTTER, readingDirection: doc.project.reading_direction });
          firstPageNumber += built.length;
          return built;
        });
        if (pages.length === 0) throw new Error("The scenes produced no pages: add beats.");
        const next = applyCommand(doc, { type: "chapter.set-content", chapterId, pages, scenes, ...(script !== undefined ? { script } : {}) });
        return { next, result: pages.map((p) => ({ id: p.id, order: p.order, panels: p.panels.length })) };
      });
      return json({ pages: result, saved });
    },
  );

  server.registerTool(
    "apply_commands",
    {
      title: "Apply editor commands",
      description: `Applies editor commands atomically (all or none), then saves. ${COMMANDS_HELP}`,
      inputSchema: {
        ...projectParam,
        commands: z.array(z.object({ type: z.string() }).passthrough()).min(1),
      },
    },
    async ({ project, commands }) => {
      const dir = await workspace.locate(project);
      const { saved } = await workspace.mutate(dir, (doc) => ({
        next: commands.reduce((current, command, i) => {
          try {
            return applyCommand(current, command as unknown as Command);
          } catch (error) {
            throw new Error(`Command ${i} (${command.type}): ${error instanceof Error ? error.message : String(error)}`);
          }
        }, doc),
        result: null,
      }));
      return json({ applied: commands.length, saved });
    },
  );

  server.registerTool(
    "preview_page",
    {
      title: "Preview page",
      description: "Renders a page to PNG in the primary target, with lettering, so you can look at it. Panels without art show the draft layer.",
      inputSchema: {
        ...projectParam,
        pageId: z.string(),
        draft: z.boolean().default(true).describe("Show the draft layer (camera and action notes) in panels without art."),
        widthPx: z.number().int().min(200).max(2400).default(900),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ project, pageId, draft, widthPx }) => {
      const dir = await workspace.locate(project);
      const { doc } = await workspace.read(dir);
      const { png, issues } = await previewPage(workspace.store(dir), doc, pageId, { draft, widthPx });
      return {
        content: [
          { type: "image", data: Buffer.from(png).toString("base64"), mimeType: "image/png" },
          ...(issues.length > 0 ? [{ type: "text" as const, text: JSON.stringify(issues, null, 2) }] : []),
        ],
      };
    },
  );

  server.registerTool(
    "export_chapter",
    {
      title: "Export chapter",
      description: "Exports a chapter for one or more of the project's targets (page PNGs, webtoon strip slices, CBZ archive…) into exports/<chapterId>/ inside the project.",
      inputSchema: {
        ...projectParam,
        chapterId: z.string(),
        targets: z.array(z.string()).default([]).describe("Target ids from get_project. Empty: the primary page target."),
        draft: z.boolean().default(false).describe("Include the draft layer in panels without art."),
      },
    },
    async ({ project, chapterId, targets, draft }) => {
      const dir = await workspace.locate(project);
      const { doc } = await workspace.read(dir);
      const store = workspace.store(dir);
      const { files, issues } = await exportChapter(store, doc, chapterId, targets, draft);
      const folder = `exports/${chapterId}`;
      const written = await workspace.withProjectLock(dir, async (locked) => {
        for (const file of files) {
          const data = typeof file.data === "string" ? new TextEncoder().encode(file.data) : file.data;
          await locked.writeBytes(`${folder}/${file.name}`, data);
        }
        return files.map((file) => path.join(dir, folder, file.name));
      });
      return json({ written, issues });
    },
  );
}
