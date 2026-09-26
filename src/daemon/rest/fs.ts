import { request, type GetOptions } from "./client";
import type { components } from "../types/rest.gen";

type FsEntryOut = components["schemas"]["FsEntryOut"];
type FsNodeOut = components["schemas"]["FsNodeOut"];

export async function listFsRoots(options?: GetOptions): Promise<FsEntryOut[]> {
  return request<FsEntryOut[]>("/v1/fs/roots", { ...options });
}

export async function listFsDir(path: string, options?: GetOptions): Promise<FsEntryOut[]> {
  return request<FsEntryOut[]>("/v1/fs/list", { query: { path }, ...options });
}

export async function browseFsTree(
  path: string,
  depth?: number,
  options?: GetOptions,
): Promise<FsNodeOut> {
  return request<FsNodeOut>("/v1/fs/tree", {
    query: { path, depth: depth === undefined ? undefined : depth },
    ...options,
  });
}

export async function listFsProjects(options?: GetOptions): Promise<string[]> {
  return request<string[]>("/v1/fs/projects", { ...options });
}
