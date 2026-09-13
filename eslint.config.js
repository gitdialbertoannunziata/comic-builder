// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    // §11.2: "Il Core non sa niente di immagini" è un vincolo verificato dal lint,
    // non solo un'intenzione — nessun accesso a rete, filesystem o React nel Core.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fs", message: "Il Core non accede al filesystem: usa PlatformService (§11.1)." },
            { name: "node:fs", message: "Il Core non accede al filesystem: usa PlatformService (§11.1)." },
            { name: "fs/promises", message: "Il Core non accede al filesystem: usa PlatformService (§11.1)." },
            { name: "http", message: "Il Core non accede alla rete: usa ImageService/LlmService (§11.1)." },
            { name: "https", message: "Il Core non accede alla rete: usa ImageService/LlmService (§11.1)." },
            { name: "net", message: "Il Core non accede alla rete: usa ImageService/LlmService (§11.1)." },
            { name: "react", message: "Il Core non dipende da React: la UI vive fuori dal Core (§11.2)." },
            { name: "react-dom", message: "Il Core non dipende da React: la UI vive fuori dal Core (§11.2)." },
          ],
        },
      ],
    },
  },
);
