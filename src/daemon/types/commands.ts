import type { HarnessKind } from "./ws";

export interface NativeCommand {
  id: string;
  name: string;
  description: string;
  aliases: string[];
  argument_hint?: string | null;
  accepts_arguments?: boolean;
  kind: string;
  available?: boolean;
  unavailable_reason?: string | null;
}

export interface CommandCatalogScope {
  harness: HarnessKind;
  cwd?: string;
  profile_id?: string | null;
  execution_backend?: "host" | "docker";
  privacy_mode?: "none" | "surrogate";
}

export interface CommandCatalog extends CommandCatalogScope {
  cwd: string;
  profile_id: string | null;
  execution_backend: "host" | "docker";
  privacy_mode: "none" | "surrogate";
  state: "ready" | "unavailable";
  commands: NativeCommand[];
  reason?: string | null;
}

export interface CommandResult {
  kind: "text" | "list" | "fields" | "notice" | "transcript";
  title?: string | null;
  text?: string | null;
  message?: string | null;
  items?: { title: string; description?: string | null }[];
  fields?: { label: string; value: string | number | boolean | null }[];
  empty_message?: string | null;
}

export interface CommandInvocation {
  invocation_id: string;
  arguments?: string;
  session_id: string;
  command: NativeCommand;
  state: "running" | "succeeded" | "failed" | "unknown" | "interrupted";
  result?: CommandResult | null;
  error?: string | null;
  cancellable: boolean;
}

export interface CommandParams {
  "command.catalogs": Record<string, never>;
  "command.catalog": CommandCatalogScope & { force_refresh?: boolean };
  "session.commands": { session_id: string };
  "command.invoke": {
    session_id: string;
    invocation_id: string;
    command_id: string;
    arguments: string;
  };
  "command.get": { session_id: string; invocation_id: string };
  "command.list": { session_id: string };
  "command.cancel": { session_id: string; invocation_id: string };
}

export interface CommandResults {
  "command.catalogs": { catalogs: CommandCatalog[]; default_cwd: string };
  "command.catalog": CommandCatalog;
  "session.commands": { commands: NativeCommand[]; reason?: string | null };
  "command.invoke": CommandInvocation;
  "command.get": CommandInvocation;
  "command.list": { invocations: CommandInvocation[] };
  "command.cancel": CommandInvocation;
}

export type CommandRequest = {
  [A in keyof CommandParams]: {
    type: "request";
    op_id: string;
    action: A;
    params: CommandParams[A];
  };
}[keyof CommandParams];
