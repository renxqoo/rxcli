import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../args.js";
import { defineAuth } from "../auth/index.js";
import { fileStore, memoryStore } from "../credentials/config-store.js";
import { defaultProviders, resolveWithChain } from "../credentials/providers.js";
import { defineCli, defineCommand } from "../define.js";
import { ValidationError } from "../errs/index.js";
import { readReference } from "../skills/reader.js";
import { createBuiltinSkillsCommands } from "../skills/builtin.js";
import { createTestCtx } from "../test-utils.js";
import type { Plugin } from "../types.js";

describe("args: reject ambiguous or unsafe values", () => {
  it("rejects undeclared flags instead of silently ignoring typos", () => {
    expect(() => parseArgs(undefined, { limti: "10" }, [])).toThrow(ValidationError);
  });

  it("rejects non-finite numbers", () => {
    expect(() => parseArgs({ limit: { type: "number" } }, { limit: "Infinity" }, [])).toThrow(
      ValidationError,
    );
  });

  it("validates and coerces defaults through the declared type", () => {
    expect(parseArgs({ limit: { type: "number", default: "10" } }, {}, [])).toEqual({
      limit: 10,
    });
    expect(() => parseArgs({ enabled: { type: "boolean", default: "sometimes" } }, {}, [])).toThrow(
      ValidationError,
    );
  });

  it("rejects contradictory required/default schemas during command definition", () => {
    expect(() =>
      defineCommand({
        name: "bad",
        description: "bad",
        args: { limit: { type: "number", required: true, default: 10 } },
        async run() {},
      }),
    ).toThrow(/required.*default/);
  });

  it("rejects a required positional after an optional positional", () => {
    expect(() =>
      defineCommand({
        name: "bad",
        description: "bad",
        args: {
          prefix: { type: "string", positional: true },
          id: { type: "string", positional: true, required: true },
        },
        async run() {},
      }),
    ).toThrow(/required positional argument/);
  });
});

describe("defineCli: plugin lifecycle boundaries", () => {
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    });
  });

  afterEach(() => {
    stdout = "";
    stderr = "";
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs a plugin guard for an app command that overrides a plugin-provided route", async () => {
    let guardCalls = 0;
    const plugin: Plugin = {
      name: "guard",
      provides: {
        commands: {
          show: defineCommand({
            name: "show",
            description: "plugin default",
            async run() {
              return { data: { source: "plugin" } };
            },
          }),
        },
      },
      async beforeCommand() {
        guardCalls++;
      },
    };
    const app = defineCli({
      name: "demo",
      description: "demo",
      plugins: [plugin],
      commands: {
        show: defineCommand({
          name: "show",
          description: "app override",
          async run() {
            return { data: { source: "app" } };
          },
        }),
      },
      defaultFormat: "json",
    });

    await app.run(["show"]);
    expect(guardCalls).toBe(1);
  });

  it("passes the reserved --api-key flag to the auth provider chain", async () => {
    const auth = await defineAuth({
      credentialNamespace: "crm",
      baseUrl: "https://example.test",
      store: memoryStore(),
    });
    const app = defineCli({
      name: "crm",
      description: "crm",
      plugins: [auth],
      commands: {
        whoami: defineCommand({
          name: "whoami",
          description: "probe auth",
          async run() {
            return { data: { authenticated: true } };
          },
        }),
      },
      defaultFormat: "json",
    });

    await app.run(["whoami", "--api-key", "sk_once"]);
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(stdout).data.authenticated).toBe(true);
  });

  it("rejects --api-key without a value before command execution", async () => {
    let ran = false;
    const app = defineCli({
      name: "demo",
      description: "demo",
      commands: {
        run: defineCommand({
          name: "run",
          description: "run",
          async run() {
            ran = true;
            return { data: null };
          },
        }),
      },
      defaultFormat: "json",
    });
    await app.run(["run", "--api-key"]);
    expect(process.exitCode).toBe(2);
    expect(ran).toBe(false);
    expect(JSON.parse(stderr).error.param).toBe("--api-key");
  });

  it("keeps --json available to auth login while also selecting JSON output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            device_code: "dc",
            user_code: "uc",
            verification_uri: "https://verify.test",
            expires_in: 600,
            interval: 5,
          }),
          { status: 200 },
        ),
      ),
    );
    const auth = await defineAuth({
      credentialNamespace: "crm",
      baseUrl: "https://auth.test",
      store: memoryStore(),
    });
    const app = defineCli({
      name: "crm",
      description: "crm",
      plugins: [auth],
      commands: {},
      defaultFormat: "human",
    });
    await app.run(["auth", "login", "--no-wait", "--json"]);
    expect(JSON.parse(stdout).data).toMatchObject({ device_code: "dc", user_code: "uc" });
  });

  it("preserves prototype hooks on class-based plugins", async () => {
    let calls = 0;
    class ClassPlugin implements Plugin {
      name = "class-plugin";
      #localCalls = 0;
      async beforeCommand() {
        this.#localCalls++;
        calls++;
      }
      get localCalls() {
        return this.#localCalls;
      }
    }
    const plugin = new ClassPlugin();
    const app = defineCli({
      name: "demo",
      description: "demo",
      plugins: [plugin],
      commands: {
        run: defineCommand({
          name: "run",
          description: "run",
          async run() {
            return { data: null };
          },
        }),
      },
      defaultFormat: "json",
    });
    await app.run(["run"]);
    expect(calls).toBe(1);
    expect(plugin.localCalls).toBe(1);
  });

  it("accepts frozen plugins because app assembly does not mutate them", async () => {
    let calls = 0;
    const plugin = Object.freeze<Plugin>({
      name: "frozen",
      async beforeCommand() {
        calls++;
      },
    });
    const app = defineCli({
      name: "demo",
      description: "demo",
      plugins: [plugin],
      commands: {
        run: defineCommand({
          name: "run",
          description: "run",
          async run() {
            return { data: null };
          },
        }),
      },
      defaultFormat: "json",
    });
    await app.run(["run"]);
    expect(calls).toBe(1);
  });

  it("rejects value flags without a value", async () => {
    const app = defineCli({
      name: "demo",
      description: "demo",
      commands: {
        get: defineCommand({
          name: "get",
          description: "get",
          args: { id: { type: "string" } },
          async run(args) {
            return { data: args };
          },
        }),
      },
      defaultFormat: "json",
    });
    await app.run(["get", "--id"]);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(stderr).error.subtype).toBe("missing_required");
  });

  it("collects repeated array flags in declaration order", async () => {
    const app = defineCli({
      name: "demo",
      description: "demo",
      commands: {
        list: defineCommand({
          name: "list",
          description: "list",
          args: { tag: { type: "array" } },
          async run(args) {
            return { data: args };
          },
        }),
      },
      defaultFormat: "json",
    });
    await app.run(["list", "--tag", "a", "--tag=b"]);
    expect(JSON.parse(stdout).data.tag).toEqual(["a", "b"]);
  });

  it("treats --help and --version after -- as literal positionals", async () => {
    const app = defineCli({
      name: "demo",
      description: "demo",
      commands: {
        echo: defineCommand({
          name: "echo",
          description: "echo",
          args: { value: { type: "string", positional: true, required: true } },
          async run(args) {
            return { data: args };
          },
        }),
      },
      defaultFormat: "json",
    });
    await app.run(["echo", "--", "--help"]);
    expect(JSON.parse(stdout).data.value).toBe("--help");
    stdout = "";
    await app.run(["echo", "--", "--version"]);
    expect(JSON.parse(stdout).data.value).toBe("--version");
  });

  it("does not let --help after -- turn an unknown command into success", async () => {
    const app = defineCli({ name: "demo", description: "demo", commands: {} });
    await app.run(["bogus", "--", "--help"]);
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(stderr).error.subtype).toBe("invalid_argument");
  });

  it("merges custom skills namespace commands with builtins", async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), "rxcli-builtins-"));
    const app = defineCli({
      name: "demo",
      description: "demo",
      skillsDir,
      commands: {},
      namespaces: {
        skills: {
          custom: defineCommand({
            name: "custom",
            description: "custom",
            async run() {
              return { data: { custom: true } };
            },
          }),
        },
      },
      defaultFormat: "json",
    });
    await app.run(["skills", "custom"]);
    expect(JSON.parse(stdout).data.custom).toBe(true);
  });
});

describe("credential provider ownership", () => {
  it("routes stored OAuth credentials through oauthProvider, preserving refresh metadata", async () => {
    const store = memoryStore({
      credentials: {
        crm: {
          authMethod: "oauth",
          token: "access",
          refreshToken: "refresh",
          expiresAt: 123,
          scopes: ["read"],
        },
      },
    });
    const result = await resolveWithChain(defaultProviders(), {
      namespace: "crm",
      configStore: store,
      args: {},
      env: {},
    });
    expect(result?.provider.name()).toBe("oauth");
    expect(result?.token).toMatchObject({ refreshToken: "refresh", expiresAt: 123 });
  });
});

describe("filesystem boundaries", () => {
  it("fileStore rejects credential namespaces that escape its credentials directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "rxcli-store-"));
    const store = fileStore({ dir: root });
    await expect(store.saveCredentials("../../escaped", { token: "secret" })).rejects.toThrow();
    expect(() => readFileSync(join(root, "..", "escaped.json"))).toThrow();
  });

  it("fileStore reports corrupted credential JSON instead of pretending the user is logged out", async () => {
    const root = mkdtempSync(join(tmpdir(), "rxcli-store-corrupt-"));
    mkdirSync(join(root, "credentials"), { recursive: true });
    writeFileSync(join(root, "credentials", "crm.json"), "{broken");
    await expect(fileStore({ dir: root }).loadCredentials("crm")).rejects.toMatchObject({
      subtype: "invalid_config",
    });
  });

  it("readReference rejects symlinks that resolve outside the selected skill", () => {
    const root = mkdtempSync(join(tmpdir(), "rxcli-skills-"));
    const skill = join(root, "orders");
    const outside = join(root, "secret.txt");
    writeFileSync(outside, "secret");
    mkdirSync(join(skill, "references"), { recursive: true });
    writeFileSync(join(skill, "SKILL.md"), "---\nname: orders\ndescription: x\n---\n");
    symlinkSync(outside, join(skill, "references", "secret.txt"));

    expect(() => readReference(root, "orders", "references/secret.txt")).toThrow();
  });

  it("skills gen rejects a skill name that would write outside skillsDir", async () => {
    const root = mkdtempSync(join(tmpdir(), "rxcli-gen-"));
    const skillsDir = join(root, "skills");
    mkdirSync(skillsDir);
    const commands = createBuiltinSkillsCommands("demo", skillsDir, {
      name: "demo",
      binName: "demo",
      commands: {},
    });
    await expect(
      commands.gen.run({ name: "../outside", init: true }, createTestCtx()),
    ).rejects.toThrow();
    expect(existsSync(join(root, "outside", "SKILL.md"))).toBe(false);
  });

  it("skills gen rejects an existing skill directory symlinked outside skillsDir", async () => {
    const root = mkdtempSync(join(tmpdir(), "rxcli-gen-link-"));
    const skillsDir = join(root, "skills");
    const outside = join(root, "outside");
    mkdirSync(skillsDir);
    mkdirSync(outside);
    symlinkSync(outside, join(skillsDir, "orders"));
    const commands = createBuiltinSkillsCommands("demo", skillsDir, {
      name: "demo",
      binName: "demo",
      commands: {},
    });
    await expect(
      commands.gen.run({ name: "orders", init: true }, createTestCtx()),
    ).rejects.toThrow();
    expect(existsSync(join(outside, "SKILL.md"))).toBe(false);
  });
});
