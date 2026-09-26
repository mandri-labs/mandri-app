import { request } from "./client";
import type { components } from "../types/rest.gen";

export type SessionAvailability = components["schemas"]["SessionAvailability"];

export const getSessionAvailability = (id: string): Promise<SessionAvailability> =>
  request(`/v1/sessions/${encodeURIComponent(id)}/availability`);

export const releaseSession = (id: string): Promise<SessionAvailability> =>
  request(`/v1/sessions/${encodeURIComponent(id)}/release`, {
    method: "POST",
    body: { confirmed: true },
    timeoutMs: null,
  });

export const restoreNativeModel = (id: string): Promise<SessionAvailability> =>
  request(`/v1/sessions/${encodeURIComponent(id)}/restore-native-model`, {
    method: "POST",
    timeoutMs: null,
  });
