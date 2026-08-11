import type { CommandGroup, CommandSpec, ErrorOnStatus, Plugin } from "./types.js";
import { SUBTYPE_REGISTRY } from "./errs/index.js";
import {
  compileCommandSchema,
  RESERVED_ARGUMENT_NAMES,
  type CompiledCommandSchema,
} from "./command-schema.js";

export const RESERVED_FRAMEWORK_ARGS = RESERVED_ARGUMENT_NAMES;
const ROUTE_IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface RegistryEntry<State> {
  route: string[];
  spec: CommandSpec<any, unknown, State>;
  schema: CompiledCommandSchema;
  owner?: Plugin<State>;
}

export class CommandRegistry<State> {
  readonly #entries = new Map<string, RegistryEntry<State>>();

  registerPlugin(plugin: Plugin<State>): void {
    for (const [name, spec] of Object.entries(plugin.provides?.commands ?? {})) {
      this.#register([name], spec, plugin, true);
    }
    for (const [namespace, group] of Object.entries(plugin.provides?.namespaces ?? {})) {
      assertRouteIdentifier(namespace, "namespace");
      for (const [name, spec] of Object.entries(group)) {
        this.#register([namespace, name], spec, plugin, true);
      }
    }
  }

  registerApplication(
    commands: CommandGroup<State>,
    namespaces: Record<string, CommandGroup<State>> = {},
  ): void {
    for (const [name, spec] of Object.entries(commands))
      this.#register([name], spec, undefined, true);
    for (const [namespace, group] of Object.entries(namespaces)) {
      assertRouteIdentifier(namespace, "namespace");
      for (const [name, spec] of Object.entries(group)) {
        this.#register([namespace, name], spec, undefined, true);
      }
    }
  }

  registerDefault(route: string[], spec: CommandSpec<any, unknown, State>): void {
    this.#register(route, spec, undefined, false);
  }

  has(route: string[]): boolean {
    return this.#entries.has(routeKey(route));
  }

  routed(): Array<{
    route: string[];
    spec: CommandSpec<any, unknown, State>;
    schema: CompiledCommandSchema;
  }> {
    return [...this.#entries.values()].map(({ route, spec, schema }) => ({
      route: [...route],
      spec,
      schema,
    }));
  }

  commands(): CommandGroup<State> {
    const commands: CommandGroup<State> = {};
    for (const entry of this.#entries.values()) {
      if (entry.route.length === 1) commands[entry.route[0]!] = entry.spec;
    }
    return commands;
  }

  namespaces(): Record<string, CommandGroup<State>> {
    const namespaces: Record<string, CommandGroup<State>> = {};
    for (const entry of this.#entries.values()) {
      if (entry.route.length !== 2) continue;
      const [namespace, name] = entry.route as [string, string];
      namespaces[namespace] ??= {};
      namespaces[namespace]![name] = entry.spec;
    }
    return namespaces;
  }

  ownedRoutes(plugins: Plugin<State>[]): ReadonlyMap<Plugin<State>, string[][]> {
    const ownership = new Map<Plugin<State>, string[][]>(plugins.map((plugin) => [plugin, []]));
    for (const entry of this.#entries.values()) {
      if (entry.owner) ownership.get(entry.owner)?.push([...entry.route]);
    }
    return ownership;
  }

  #register(
    route: string[],
    spec: CommandSpec<any, unknown, State>,
    owner: Plugin<State> | undefined,
    overwrite: boolean,
  ): void {
    if (route.length < 1 || route.length > 2)
      throw new Error("command route must have 1-2 segments");
    route.forEach((segment, index) =>
      assertRouteIdentifier(segment, index === route.length - 1 ? "command" : "namespace"),
    );
    const schema = validateCommandSpec(route.at(-1)!, spec);
    const key = routeKey(route);
    if (!overwrite && this.#entries.has(key)) return;
    this.#entries.set(key, { route: [...route], spec, schema, ...(owner ? { owner } : {}) });
  }
}

export function validateCommandSpec(
  routeName: string,
  spec: CommandSpec<any, unknown, any>,
): CompiledCommandSchema {
  assertRouteIdentifier(routeName, "command");
  assertRouteIdentifier(spec.name, "command");
  if (routeName !== spec.name) {
    throw new Error(`route key "${routeName}" must equal command name "${spec.name}"`);
  }
  if (typeof spec.run !== "function") {
    throw new Error(`command ${spec.name}: run is required and must be a function`);
  }
  return compileCommandSchema(spec.name, spec.args, spec.policy);
}

export function assertRouteIdentifier(value: string, kind: "app" | "namespace" | "command"): void {
  if (!ROUTE_IDENTIFIER.test(value)) {
    throw new Error(
      `${kind} identifier "${value}" is invalid; use lowercase letters, digits, and single hyphens`,
    );
  }
}

export function validateErrorOnStatus(mapping?: ErrorOnStatus): void {
  for (const [statusKey, subtype] of Object.entries(mapping ?? {})) {
    if (!/^(?:[1-5]\d\d|[1-5]xx)$/.test(statusKey)) {
      throw new Error(
        `defineCli({ errorOnStatus }): invalid status key "${statusKey}". ` +
          `Use an HTTP status from 100 to 599 or a class from 1xx to 5xx.`,
      );
    }
    if (!(subtype in SUBTYPE_REGISTRY)) {
      throw new Error(
        `defineCli({ errorOnStatus }): subtype "${subtype}" (mapped to status ${statusKey}) ` +
          `is not registered in SUBTYPE_REGISTRY.`,
      );
    }
  }
}

function routeKey(route: string[]): string {
  return route.join("\u0000");
}
