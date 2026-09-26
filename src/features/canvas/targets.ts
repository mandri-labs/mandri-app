export interface FileTarget {
  kind: "file";
  path: string;
  title: string;
  line?: number;
  column?: number;
  endLine?: number;
  anchor?: string;
}
export interface ImageTarget {
  kind: "image";
  source: string;
  file?: File;
  path?: string;
  title: string;
}
export interface ExcerptTarget {
  kind: "excerpt";
  id: string;
  text: string;
  language: string;
  title: string;
}
export type CanvasTarget = FileTarget | ImageTarget | ExcerptTarget;
export function isLocalReference(href: string): boolean {
  return (
    !!href &&
    !href.startsWith("//") &&
    (/^[^:/]+\.[a-z0-9]+:\d+(?::\d+)?(?:#.*)?$/i.test(href) ||
      /^[a-z]:[\\/]/i.test(href) ||
      !/^[a-z][a-z0-9+.-]*:/i.test(href))
  );
}
export function fileTarget(href: string, basePath?: string): FileTarget {
  const hash = href.indexOf("#");
  const fragment = hash < 0 ? undefined : decodeURIComponent(href.slice(hash + 1));
  let path = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
  let line: number | undefined, column: number | undefined, endLine: number | undefined;
  const range = fragment?.match(/^L(\d+)(?:-L?(\d+))?$/i);
  const suffix = path.match(/:(\d+)(?::(\d+))?$/);
  if (range) {
    line = Number(range[1]);
    endLine = range[2] ? Number(range[2]) : undefined;
  } else if (suffix) {
    path = path.slice(0, -suffix[0].length);
    line = Number(suffix[1]);
    column = suffix[2] ? Number(suffix[2]) : undefined;
  }
  path = path.replace(/\\/g, "/");
  if (!path && basePath) path = basePath;
  else if (basePath && !path.startsWith("/") && !/^[a-z]:\//i.test(path))
    path = basePath.replace(/[^/\\]+$/, "") + path;
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === ".." && parts.length && parts.at(-1) !== ".." && !/^[a-z]:$/i.test(parts.at(-1)!))
      parts.pop();
    else if (part !== ".." || !absolute) parts.push(part);
  }
  path = (absolute ? "/" : "") + parts.join("/");
  if (!path || !isLocalReference(path)) throw new Error("Invalid file reference");
  return {
    kind: "file",
    path,
    title: path.split("/").pop() || path,
    line,
    column,
    endLine,
    anchor: range ? undefined : fragment,
  };
}
export function targetKey(target: CanvasTarget): string {
  return target.kind === "excerpt"
    ? `excerpt:${target.id}`
    : target.kind === "file"
      ? `file:${target.path}`
      : target.path
        ? `file:${target.path}`
        : `image:${target.source}`;
}
