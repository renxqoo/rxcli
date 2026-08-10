import type { CommandContext } from "../types.js";
import type { TokenResult } from "../credentials/types.js";

export interface AuthSession {
  token: string;
  type: TokenResult["type"];
  source: string;
  refreshable: boolean;
}

const sessions = new WeakMap<CommandContext<any>, AuthSession>();

/** 将认证状态绑定到一次命令执行的 ctx，避免可复用 plugin 在并发调用间共享 token。 */
export function setAuthSession<State>(
  ctx: CommandContext<State>,
  session: AuthSession,
): AuthSession {
  sessions.set(ctx, session);
  return session;
}

export function getAuthSession<State>(ctx: CommandContext<State>): AuthSession | undefined {
  return sessions.get(ctx);
}

export function updateAuthSessionToken<State>(
  ctx: CommandContext<State>,
  token: string,
): AuthSession | undefined {
  const current = sessions.get(ctx);
  if (!current) return undefined;
  const updated = { ...current, token };
  sessions.set(ctx, updated);
  return updated;
}
