import type { ActivityKind, ToolAction } from "./types";
import { asRecord, stringAt, toolTargetFromInput } from "./shared";

const claude: Record<string, ActivityKind> = {
  Read: "read",
  Glob: "list",
  Grep: "search",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Bash: "command",
  WebFetch: "web",
  WebSearch: "web",
};
const opencode: Record<string, ActivityKind> = {
  read: "read",
  glob: "list",
  grep: "search",
  list: "list",
  edit: "edit",
  write: "edit",
  apply_patch: "edit",
  patch: "edit",
  bash: "command",
  webfetch: "web",
  websearch: "web",
  codesearch: "search",
};
const agy: Record<string, ActivityKind> = {
  view_file: "read",
  view_file_outline: "read",
  view_code_item: "read",
  list_directory: "list",
  list_dir: "list",
  find_file: "list",
  find_by_name: "list",
  search_directory: "search",
  grep_search: "search",
  search_in_file: "search",
  create_file: "edit",
  edit_file: "edit",
  write_to_file: "edit",
  replace_file_content: "edit",
  multi_replace_file_content: "edit",
  run_command: "command",
  command_status: "command",
  search_web: "web",
  read_url_content: "web",
  view_web_document: "web",
};
const codex: Record<string, ActivityKind> = {
  apply_patch: "edit",
  shell: "command",
  shell_command: "command",
  exec_command: "command",
};
const pi: Record<string, ActivityKind> = { read: "read", write: "edit", edit: "edit", bash: "command", grep: "search", find: "list", ls: "list" };
const legacy = { ...claude, ...opencode, ...agy, ...codex };
const providers = { pi, claude, opencode, agy, codex, legacy };

export function nativeToolActions(
  name: string,
  input?: Record<string, unknown>,
  provider: keyof typeof providers = "legacy",
): ToolAction[] {
  return [
    {
      kind: providers[provider][name] ?? "tool",
      target: toolTargetFromInput(input),
      query:
        stringAt(input, "query") ?? stringAt(input, "pattern") ?? stringAt(input, "SearchTerm"),
    },
  ];
}

export function codexCommandActions(value: unknown): ToolAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => {
    const action = asRecord(entry);
    switch (action?.type) {
      case "read":
      case "Read":
        return { kind: "read", target: stringAt(action, "path") ?? stringAt(action, "name") };
      case "listFiles":
      case "list_files":
      case "ListFiles":
        return { kind: "list", target: stringAt(action, "path") };
      case "search":
      case "Search":
        return {
          kind: "search",
          target: stringAt(action, "path"),
          query: stringAt(action, "query"),
        };
      default:
        return { kind: "command", target: stringAt(action, "command") ?? stringAt(action, "cmd") };
    }
  });
}
