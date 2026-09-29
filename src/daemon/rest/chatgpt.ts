import type { components } from "../types/rest.gen";
import { request, type CallOptions } from "./client";
import { invalidateProviders } from "./providers";

export type ChatGptLogin = components["schemas"]["LoginOut"];

export async function startChatGptLogin(name: string, apiBase?: string): Promise<ChatGptLogin> {
  return request<ChatGptLogin>("/v1/providers/chatgpt/login", {
    method: "POST",
    body: { name, ...(apiBase ? { api_base: apiBase } : {}) },
  });
}

export async function getChatGptLogin(id: string, options?: CallOptions): Promise<ChatGptLogin> {
  const login = await request<ChatGptLogin>(
    `/v1/providers/chatgpt/login/${encodeURIComponent(id)}`,
    options,
  );
  if (login.status === "completed") invalidateProviders();
  return login;
}

export async function submitChatGptRedirect(
  id: string,
  redirectUrl: string,
): Promise<ChatGptLogin> {
  const login = await request<ChatGptLogin>(
    `/v1/providers/chatgpt/login/${encodeURIComponent(id)}/callback`,
    {
      method: "POST",
      body: { redirect_url: redirectUrl },
      timeoutMs: 30_000,
    },
  );
  if (login.status === "completed") invalidateProviders();
  return login;
}

export async function cancelChatGptLogin(id: string): Promise<ChatGptLogin> {
  return request<ChatGptLogin>(`/v1/providers/chatgpt/login/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
