import type { components } from "../types/rest.gen";
import { request } from "./client";

export type McpServer = components["schemas"]["McpServerView"];
export type McpConfig = components["schemas"]["McpServerConfig"];
export type McpSnapshot = components["schemas"]["McpSnapshot"];
export type McpChanges = Partial<McpConfig> & {
  env_updates?: Record<string, string | null>;
  header_updates?: Record<string, string | null>;
};

export function listMcpServers(): Promise<McpSnapshot> {
  return request("/v1/mcp/servers");
}

export function createMcpServer(body: McpConfig): Promise<McpServer> {
  return request("/v1/mcp/servers", { method: "POST", body });
}

export function updateMcpServer(server: McpServer, changes: McpChanges): Promise<McpServer> {
  return request(`/v1/mcp/servers/${encodeURIComponent(server.id)}`, {
    method: "PATCH",
    body: { revision: server.revision, changes },
  });
}

export function deleteMcpServer(id: string): Promise<void> {
  return request(`/v1/mcp/servers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function reconnectMcpServer(id: string): Promise<McpServer> {
  return request(`/v1/mcp/servers/${encodeURIComponent(id)}/reconnect`, { method: "POST" });
}

export function loginMcpServer(id: string): Promise<McpServer> {
  return request(`/v1/mcp/servers/${encodeURIComponent(id)}/login`, { method: "POST" });
}

export function logoutMcpServer(id: string): Promise<McpServer> {
  return request(`/v1/mcp/servers/${encodeURIComponent(id)}/logout`, { method: "POST" });
}
