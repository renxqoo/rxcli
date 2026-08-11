import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // e2e 测试共用一个 server 实例(globalSetup 起,消除端口竞争)
    globalSetup: ["./src/__tests__/global-setup.ts"],
    pool: "forks",
    singleFork: true, // vitest 4: 顶层(原 poolOptions.forks.singleFork)
    testTimeout: 15000,
    include: ["src/__tests__/**/*.test.ts"],
  },
});
