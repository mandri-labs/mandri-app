import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { error as consoleError, log, warn } from "node:console";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const LIVE_OPENAPI_URL = "http://127.0.0.1:8787/v1/openapi.json";
const OUTPUT_URL = new URL("../src/daemon/types/rest.gen.d.ts", import.meta.url);
const SNAPSHOT_DIR_URL = new URL("../../mandri/api-snapshots/", import.meta.url);
const OPENAPI_SNAPSHOT_PATTERN = /^openapi.*\.json$/i;

function sourceArg(argv) {
  const index = argv.indexOf("--source");
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error("--source expects a file path or URL");
  }
  return value;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readSpecFile(rawPath) {
  const absolute = resolve(rawPath);
  let text;
  try {
    text = await readFile(absolute, "utf8");
  } catch {
    throw new Error(`cannot read OpenAPI source: ${absolute}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`OpenAPI source is not valid JSON: ${absolute}`);
  }
}

function explicitAttempt(source) {
  const isRemote = /^https?:\/\//i.test(source);
  return {
    origin: source,
    load: async () => {
      if (isRemote) {
        return openapiTS(source, { silent: true, defaultNonNullable: false });
      }
      return openapiTS(await readSpecFile(source), { silent: true, defaultNonNullable: false });
    },
  };
}

function liveAttempt() {
  return {
    origin: `live daemon (${LIVE_OPENAPI_URL})`,
    load: () => openapiTS(LIVE_OPENAPI_URL, { silent: true, defaultNonNullable: false }),
  };
}

async function newestSnapshot() {
  let entries;
  try {
    entries = await readdir(SNAPSHOT_DIR_URL, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !OPENAPI_SNAPSHOT_PATTERN.test(entry.name)) {
      continue;
    }
    const fileUrl = new URL(entry.name, SNAPSHOT_DIR_URL);
    const info = await stat(fileUrl);
    candidates.push({ fileUrl, modifiedAt: info.mtimeMs });
  }
  candidates.sort((first, second) => second.modifiedAt - first.modifiedAt);
  return candidates[0] ?? null;
}

async function snapshotAttempt() {
  const snapshot = await newestSnapshot();
  if (snapshot === null) {
    return null;
  }
  const absolute = fileURLToPath(snapshot.fileUrl);
  return {
    origin: absolute,
    load: async () =>
      openapiTS(await readSpecFile(absolute), { silent: true, defaultNonNullable: false }),
  };
}

async function attemptsFor(argv) {
  const source = sourceArg(argv);
  if (source !== null) {
    return [explicitAttempt(source)];
  }
  const attempts = [liveAttempt()];
  const snapshot = await snapshotAttempt();
  if (snapshot !== null) {
    attempts.push(snapshot);
  }
  return attempts;
}

async function generate(attempts) {
  for (const attempt of attempts) {
    try {
      const ast = await attempt.load();
      const output = astToString(ast);
      const contents = output.endsWith("\n") ? output : `${output}\n`;
      await mkdir(new URL(".", OUTPUT_URL), { recursive: true });
      await writeFile(OUTPUT_URL, contents, "utf8");
      log(`rest api types written from ${attempt.origin} to ${fileURLToPath(OUTPUT_URL)}`);
      return;
    } catch (error) {
      warn(`openapi source ${attempt.origin} unusable: ${describeError(error)}`);
    }
  }
  throw new Error(
    `no usable OpenAPI source (tried ${attempts.map((attempt) => attempt.origin).join(", ")})`,
  );
}

async function main() {
  await generate(await attemptsFor(process.argv.slice(2)));
}

main().catch((error) => {
  consoleError(describeError(error));
  process.exitCode = 1;
});
