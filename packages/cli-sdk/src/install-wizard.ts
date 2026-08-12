/** Node/terminal adapter for the installation workflow. */
import { execFile, execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileStore } from "./credentials/config-store.js";
import {
  InstallWorkflow,
  formatInstallMessage,
  isOlderVersion,
  type InstallLanguage,
  type InstallPresenter,
  type InstallSystem,
} from "./install-workflow.js";
import { detectBizPackage } from "./package-detect.js";

type Clack = typeof import("@clack/prompts");
const isWindows = process.platform === "win32";

export interface InstallWizardOptions {
  skillsSource?: string;
  binName?: string;
  pkgName?: string;
  /**
   * Optional app config directory. When provided, the wizard can detect an already
   * registered client and skip `auth register`. cli-sdk imposes no default; the app
   * decides where its config lives.
   */
  configDir?: string;
}

export const fmt = formatInstallMessage;
export const semverLessThan = isOlderVersion;

export function parseLangArg(
  argv: readonly string[] = process.argv.slice(2),
): InstallLanguage | null {
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const value = argument === "--lang" ? argv[index + 1] : argument.split("--lang=")[1];
    if ((argument === "--lang" || argument.startsWith("--lang=")) && value) {
      const normalized = value.toLowerCase();
      if (normalized === "zh" || normalized === "en") return normalized;
    }
  }
  return null;
}

function execCommand(command: string, args: string[], options?: ExecFileSyncOptions): Buffer {
  return execFileSync(
    isWindows ? "cmd.exe" : command,
    isWindows ? ["/c", command, ...args] : args,
    options,
  ) as Buffer;
}

function runAsync(
  command: string,
  args: string[],
  options: ExecFileSyncOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      isWindows ? "cmd.exe" : command,
      isWindows ? ["/c", command, ...args] : args,
      { stdio: ["ignore", "pipe", "pipe"], ...options },
      (error, stdout) => (error ? reject(error) : resolve(stdout as Buffer)),
    );
  });
}

function findGlobalBinary(binName: string): string | null {
  try {
    const prefix = execCommand("npm", ["prefix", "-g"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    const candidate = isWindows ? join(prefix, `${binName}.cmd`) : join(prefix, "bin", binName);
    if (existsSync(candidate)) return candidate;
  } catch {
    // Fall through to the shell path lookup.
  }
  try {
    return execCommand(isWindows ? "where" : "which", [binName], {
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .split("\n")[0]!
      .trim();
  } catch {
    return null;
  }
}

class NodeInstallSystem implements InstallSystem {
  constructor(private readonly configDir?: string) {}

  async globallyInstalledVersion(packageName: string): Promise<string | null> {
    try {
      const output = execCommand("npm", ["list", "-g", packageName], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      }).toString();
      return output.match(/@(\d+\.\d+\.\d+[^\s]*)/)?.[1] ?? "unknown";
    } catch {
      return null;
    }
  }

  async latestVersion(packageName: string): Promise<string | null> {
    try {
      const version = execCommand("npm", ["view", packageName, "version"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      })
        .toString()
        .trim();
      return /^\d+\.\d+\.\d+/.test(version) ? version : null;
    } catch {
      return null;
    }
  }

  async installGlobally(packageName: string): Promise<void> {
    await runAsync("npm", ["install", "-g", packageName], { timeout: 120_000 });
  }

  async installSkillsFrom(source: string): Promise<void> {
    await runAsync("npx", ["-y", "skills", "add", source, "-y", "-g"], { timeout: 120_000 });
  }

  async findBinary(binName: string): Promise<string | null> {
    return findGlobalBinary(binName);
  }

  async syncSkills(binary: string): Promise<void> {
    await runAsync(binary, ["skills", "sync"], { timeout: 60_000 });
  }

  async isRegistered(): Promise<boolean> {
    // cli-sdk does not pick a config directory; only check when the app provided one.
    if (!this.configDir) return false;
    try {
      const config = (await fileStore({ dir: this.configDir }).loadConfig()) as {
        clientId?: string;
      };
      return Boolean(config.clientId);
    } catch {
      return false;
    }
  }

  async register(binary: string): Promise<void> {
    // M15: honor the async InstallSystem contract (was a blocking execFileSync).
    await runAsync(binary, ["auth", "register"], { stdio: "inherit" });
  }

  async login(binary: string): Promise<void> {
    await runAsync(binary, ["auth", "login"], { stdio: "inherit" });
  }
}

class ClackInstallPresenter implements InstallPresenter {
  private spinner?: ReturnType<Clack["spinner"]>;

  constructor(
    private readonly clack: Clack,
    private readonly interactive: boolean,
  ) {}

  async chooseLanguage(): Promise<InstallLanguage | null> {
    const value = await this.clack.select({
      message: "Select language / 请选择语言",
      options: [
        { value: "en" as const, label: "English" },
        { value: "zh" as const, label: "中文" },
      ],
    });
    return this.clack.isCancel(value) ? null : (value as InstallLanguage);
  }

  async confirmLogin(message: string): Promise<boolean | null> {
    const value = await this.clack.confirm({ message });
    return this.clack.isCancel(value) ? null : value;
  }

  intro(message: string): void {
    if (this.interactive) this.clack.intro(message);
    else console.log(message);
  }

  outro(message: string): void {
    this.clack.outro(message);
  }

  start(message: string): void {
    if (!this.interactive) return;
    this.spinner = this.clack.spinner();
    this.spinner.start(message);
  }

  update(message: string): void {
    this.spinner?.message(message);
  }

  succeed(message: string): void {
    if (this.interactive) this.spinner?.stop(message);
  }

  fail(message: string): void {
    if (this.interactive) this.spinner?.stop(message);
  }

  info(message: string): void {
    if (this.interactive) this.clack.log.info(message);
    else console.log(message);
  }

  warn(message: string): void {
    this.clack.log.warn(message);
  }

  cancel(message: string): void {
    this.clack.cancel(message);
  }
}

export async function runInstallWizard(options: InstallWizardOptions = {}): Promise<number> {
  const detected = detectBizPackage();
  const interactive = Boolean(process.stdin.isTTY);
  const clack = await import("@clack/prompts");
  const workflow = new InstallWorkflow(
    new NodeInstallSystem(options.configDir),
    new ClackInstallPresenter(clack, interactive),
  );
  return workflow.run({
    package: {
      name: options.pkgName ?? detected?.name ?? "",
      bin: options.binName ?? detected?.bin ?? "rxcli",
    },
    skillsSource: options.skillsSource,
    interactive,
    language: parseLangArg() ?? undefined,
  });
}
