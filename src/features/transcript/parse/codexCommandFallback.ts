import type { ToolAction } from "./types";

function words(command: string): string[] | undefined {
  if (/[$`|;&><\r\n(){}]|''|""/u.test(command)) return undefined;
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = "";
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/u.test(char)) {
      if (started) tokens.push(token);
      token = "";
      started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) tokens.push(token);
  return tokens;
}

export function codexCommandFallback(
  command: unknown,
  depth = 0,
  inPowerShell = false,
): ToolAction[] | undefined {
  if (depth > 2) return undefined;
  const tokens =
    typeof command === "string"
      ? words(command)
      : Array.isArray(command) && command.every((word) => typeof word === "string")
        ? command
        : undefined;
  if (!tokens?.length) return undefined;
  const name = tokens[0]!
    .split(/[\\/]/u)
    .at(-1)!
    .toLowerCase()
    .replace(/\.exe$/u, "");
  const args = tokens.slice(1);
  if (
    ["bash", "sh", "zsh"].includes(name) &&
    args.length === 2 &&
    ["-c", "-lc"].includes(args[0]!)
  ) {
    return codexCommandFallback(args[1], depth + 1);
  }
  if (["pwsh", "powershell"].includes(name)) {
    const index = args.findIndex((arg) => arg.toLowerCase() === "-command");
    if (
      index < 0 ||
      index !== args.length - 2 ||
      !args
        .slice(0, index)
        .every((arg) => ["-noprofile", "-nologo", "-noninteractive"].includes(arg.toLowerCase()))
    )
      return undefined;
    return codexCommandFallback(args[index + 1], depth + 1, true);
  }
  if (!["cat", "get-content", "gc", "type"].includes(name)) return undefined;
  if (["gc", "type"].includes(name) && !inPowerShell) return undefined;
  const powershell = inPowerShell || name === "get-content";
  const options = powershell
    ? ["-raw", "-path", "-literalpath"]
    : ["-n", "-b", "-s", "-e", "-t", "-v", "-a", "--"];
  if (args.some((arg) => arg.startsWith("-") && !options.includes(arg.toLowerCase())))
    return undefined;
  const paths = args.filter((arg) => !arg.startsWith("-"));
  if (
    !paths.length ||
    (powershell && paths.length !== 1) ||
    paths.some((path) => /[*?[\],]|\\['" ]/u.test(path) || !path)
  )
    return undefined;
  return paths.map((target) => ({ kind: "read", target }));
}
