import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [flag, ...files] = process.argv.slice(2);
if (flag !== "--reviewed" || files.length === 0)
  throw new Error("Usage: import-reviewed.mjs --reviewed <sanitized fixture.json> [...]");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
for (const file of files) {
  const text = await readFile(resolve(file), "utf8");
  const fixture = JSON.parse(text);
  if (
    !["claude", "codex", "opencode"].includes(fixture.harness) ||
    !["chat", "tools-diff", "approval", "error"].includes(fixture.scenario) ||
    !Array.isArray(fixture.frames) ||
    !Array.isArray(fixture.history?.entries)
  )
    throw new Error("Invalid fixture envelope");
  if (/sk-[a-zA-Z0-9_-]{12,}|[A-Za-z]:\\\\Users\\\\|\/home\/[^/\s]+\//.test(text))
    throw new Error("Possible credential or personal path in fixture; sanitize before import");
  const target = resolve(root, "tests/fixtures", fixture.harness, `${fixture.scenario}.json`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(fixture, null, 2) + "\n");
  console.log(
    `Imported ${fixture.harness}/${fixture.scenario}; review the diff before committing.`,
  );
}
