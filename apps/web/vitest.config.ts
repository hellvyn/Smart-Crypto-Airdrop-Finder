import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // JSX in tests uses the automatic runtime, like the app (tsconfig "jsx": "react-jsx").
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["lib/**/*.test.ts", "test/**/*.test.{ts,tsx}"],
  },
});
