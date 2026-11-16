import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 180000,
    hookTimeout: 180000,
    include: ["src/providers/imap.live.test.ts"],
  },
});
