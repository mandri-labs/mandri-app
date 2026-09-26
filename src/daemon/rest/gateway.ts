import { request, type CallOptions, type GetOptions } from "./client";
import type { components } from "../types/rest.gen";

type GatewayInfoOut = components["schemas"]["GatewayInfoOut"];
type RouteCreateIn = components["schemas"]["RouteCreateIn"];
type RouteCreatedOut = components["schemas"]["RouteCreatedOut"];
type RouteOut = components["schemas"]["RouteOut"];

export async function getGatewayInfo(options?: GetOptions): Promise<GatewayInfoOut> {
  return request<GatewayInfoOut>("/v1/gateway/info", { ...options });
}

export async function listRoutes(options?: GetOptions): Promise<RouteOut[]> {
  return request<RouteOut[]>("/v1/gateway/routes", { ...options });
}

export async function createRoute(
  body: RouteCreateIn,
  options?: CallOptions,
): Promise<RouteCreatedOut> {
  return request<RouteCreatedOut>("/v1/gateway/routes", {
    method: "POST",
    body,
    ...options,
  });
}

export async function setRouteModel(
  routeId: string,
  model: string,
  options?: CallOptions,
): Promise<RouteOut> {
  return request<RouteOut>(`/v1/gateway/routes/${encodeURIComponent(routeId)}/model`, {
    method: "PATCH",
    body: { model },
    ...options,
  });
}

export async function deleteRoute(routeId: string, options?: CallOptions): Promise<void> {
  return request<void>(`/v1/gateway/routes/${encodeURIComponent(routeId)}`, {
    method: "DELETE",
    ...options,
  });
}

export async function getGatewayModelMetadata(
  model: string,
  options?: GetOptions,
): Promise<unknown> {
  return request<unknown>("/v1/gateway/model-metadata", { query: { model }, ...options });
}
