/**
 * 本地 HTTP 回调监听(authorization_code flow 用)。
 *
 * 启动本地 HTTP server,等待 OAuth 重定向:
 *   GET http://127.0.0.1:PORT/callback?code=xxx&state=yyy
 * 拿到 code 后 resolve,关闭 server。超时 reject。
 */
import { createServer, type Server } from "node:http";

export interface CallbackResult {
  code: string | null;
  error: string | null;
  state: string | null;
}

export interface CallbackHandle {
  /** Promise resolve 后拿到回调结果。 */
  result: Promise<CallbackResult>;
  /** 回调地址(传给 /authorize 的 redirect_uri)。 */
  redirectUri: string;
  /** 关闭 server(无论结果)。 */
  close(): void;
}

/**
 * 启动本地回调 server,等待 OAuth 重定向。
 * 返回 Promise(resolve 时 server 已开始监听,redirectUri 可用)。
 *
 * @param opts.port 指定端口;不传/0 = OS 分配随机端口
 * @param opts.timeoutMs 超时(ms),超时 result reject
 */
export function waitForCallback(opts: {
  port?: number;
  timeoutMs: number;
}): Promise<CallbackHandle> {
  return new Promise((resolveSetup, rejectSetup) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resultResolve: ((v: CallbackResult) => void) | undefined;
    let resultReject: ((e: unknown) => void) | undefined;

    const result = new Promise<CallbackResult>((res, rej) => {
      resultResolve = res;
      resultReject = rej;
    });

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const state = url.searchParams.get("state");

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<html><body><h2>✓ Login successful</h2><p>You can close this tab and return to the CLI.</p></body></html>",
      );

      if (timer) clearTimeout(timer);
      server.close();
      resultResolve?.({ code, error, state });
    });

    function close(): void {
      if (timer) clearTimeout(timer);
      server.close();
    }

    server.on("error", (err) => {
      resultReject?.(err);
      rejectSetup(err);
    });

    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : opts.port;
      const redirectUri = `http://127.0.0.1:${actualPort}/callback`;

      timer = setTimeout(() => {
        server.close();
        resultReject?.(new Error(`callback timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);

      resolveSetup({ result, redirectUri, close });
    });
  });
}
