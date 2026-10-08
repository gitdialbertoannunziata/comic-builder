import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const IMAGE_PROXY = "/image-proxy/";
/** Solo gli host dei fornitori: un proxy aperto su localhost sarebbe un regalo a qualunque pagina aperta nel browser. */
const IMAGE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(bfl\.ai|services\.ai\.azure\.com|cognitiveservices\.azure\.com|api\.cognitive\.microsoft\.com)$/;

/**
 * Passaggio verso i servizi di immagini (FLUX.2 su Azure AI Foundry o da
 * Black Forest Labs): non abilitano CORS, quindi dal browser non ci si
 * arriva. `/image-proxy/<host>/<percorso>` inoltra la richiesta così com'è.
 * In un'applicazione desktop (§14.4) questo passaggio non serve.
 */
function imageProxy(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith(IMAGE_PROXY)) return next();
    const rest = req.url.slice(IMAGE_PROXY.length);
    const slash = rest.indexOf("/");
    const host = slash < 0 ? rest : rest.slice(0, slash);
    if (!IMAGE_HOST.test(host)) {
      res.statusCode = 403;
      res.end("host non consentito");
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const headers: Record<string, string> = {};
      for (const name of ["x-key", "authorization", "content-type", "accept"]) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      fetch(`https://${rest}`, { method: req.method ?? "GET", headers, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) })
        .then(async (upstream) => {
          res.statusCode = upstream.status;
          const type = upstream.headers.get("content-type");
          if (type) res.setHeader("content-type", type);
          res.end(Buffer.from(await upstream.arrayBuffer()));
        })
        .catch((error: unknown) => {
          res.statusCode = 502;
          res.end(String(error));
        });
    });
  };
  return {
    name: "image-proxy",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  plugins: [react(), imageProxy()],
  server: {
    port: 5173,
  },
});
