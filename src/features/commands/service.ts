import type { RequestParamsOf } from "@/daemon/ws/protocol";
import { getDaemonSocket } from "@/app/connection";
import type { CommandCatalog, CommandCatalogScope, CommandInvocation, CommandParams, CommandResults, NativeCommand } from "@/daemon/types/commands";
import { DaemonError } from "@/daemon/errors";

export interface CommandTransport {
  catalogs?(): Promise<{ catalogs: CommandCatalog[]; default_cwd: string }>;
  catalog(scope: CommandCatalogScope, refresh?: boolean): Promise<{ commands: NativeCommand[]; reason?: string | null }>;
  invoke(sessionId: string, invocationId: string, commandId: string, args: string): Promise<CommandInvocation>;
  list(sessionId: string): Promise<CommandInvocation[]>;
  cancel(sessionId: string, invocationId: string): Promise<CommandInvocation>;
}

function request<A extends keyof CommandParams>(action: A, params: RequestParamsOf<A>): Promise<CommandResults[A]> {
  const socket = getDaemonSocket();
  if (!socket) return Promise.reject(new DaemonError({ code: "service_unavailable", message: "Connection unavailable" }));
  return socket.request(action, params);
}

export const commandTransport: CommandTransport = {
  catalogs: () => request("command.catalogs", {}),
  catalog: (scope, refresh) => request("command.catalog", { ...scope, force_refresh: refresh || undefined }),
  invoke: (sessionId, invocationId, commandId, args) => request("command.invoke", {
    session_id: sessionId, invocation_id: invocationId, command_id: commandId, arguments: args,
  }),
  list: async (sessionId) => (await request("command.list", { session_id: sessionId })).invocations,
  cancel: (sessionId, invocationId) => request("command.cancel", { session_id: sessionId, invocation_id: invocationId }),
};
