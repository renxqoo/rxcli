/**
 * 浏览器打开抽象(authorization_code flow 用)。
 *
 * 平台相关:macOS=open, Linux=xdg-open, Windows=start。
 * 通过 BrowserOpener 接口抽象,测试可 mock。
 */
import { execFile } from "node:child_process";
import { platform } from "node:os";

export interface BrowserOpener {
  open(url: string): Promise<void>;
}

/**
 * 默认浏览器打开器:按平台选命令。
 * macOS → open, Linux → xdg-open, Windows → start。
 */
export function defaultBrowserOpener(): BrowserOpener {
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  return {
    async open(url: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const args = cmd === "start" ? ["", url] : [url];
        execFile(cmd, args, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
