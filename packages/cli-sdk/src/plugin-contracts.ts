import type { CommandGroup } from "./command-contracts.js";
import type { CommandResult, StructuredData } from "./output-contracts.js";
import type { RequestAttemptEvent, RequestOptions } from "./request-contracts.js";
import type { CommandContext } from "./runtime-contracts.js";

export type UnauthorizedDecision =
  | { action: "retry" }
  | { action: "decline" }
  | { action: "reject"; error: unknown };

export type ErrorDecision =
  | { action: "pass" }
  | { action: "replace"; error: unknown }
  | { action: "recover"; result?: CommandResult<StructuredData> };

export interface Plugin<State = Record<string, never>> {
  name: string;
  enforce?: "pre" | "normal" | "post";
  provides?: {
    namespaces?: Record<string, CommandGroup<State>>;
    commands?: CommandGroup<State>;
  };
  beforeCommand?(context: CommandContext<State>): Promise<void>;
  prepareRequest?(
    context: CommandContext<State>,
    request: Readonly<RequestOptions>,
  ): Promise<RequestOptions>;
  observeRequest?(
    context: CommandContext<State>,
    event: Readonly<RequestAttemptEvent>,
  ): Promise<void>;
  handleUnauthorized?(
    context: CommandContext<State>,
    event: Readonly<RequestAttemptEvent>,
  ): Promise<UnauthorizedDecision | undefined>;
  transformOutput?(
    context: CommandContext<State>,
    data: Readonly<StructuredData>,
  ): Promise<StructuredData>;
  observeError?(context: CommandContext<State>, error: unknown): Promise<void>;
  handleError?(context: CommandContext<State>, error: unknown): Promise<ErrorDecision | undefined>;
}
