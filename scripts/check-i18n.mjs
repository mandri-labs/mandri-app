import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const i18nDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "i18n",
);

function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix === "" ? key : `${prefix}.${key}`;
    if (child !== null && typeof child === "object") {
      return flatten(child, fullKey);
    }
    return [fullKey];
  });
}

function loadCatalog(fileName) {
  return flatten(JSON.parse(readFileSync(path.join(i18nDir, fileName), "utf8")));
}

const en = loadCatalog("en.json");
const fr = loadCatalog("fr.json");
const enSet = new Set(en);
const frSet = new Set(fr);

const missingInFr = en.filter((key) => !frSet.has(key));
const missingInEn = fr.filter((key) => !enSet.has(key));

console.log(`en keys: ${en.length}`);
console.log(`fr keys: ${fr.length}`);

let failed = false;
if (missingInFr.length > 0) {
  failed = true;
  console.log(`missing in fr.json (${missingInFr.length}):`);
  for (const key of missingInFr) {
    console.log(`  - ${key}`);
  }
}
if (missingInEn.length > 0) {
  failed = true;
  console.log(`missing in en.json (${missingInEn.length}):`);
  for (const key of missingInEn) {
    console.log(`  - ${key}`);
  }
}

if (failed) {
  console.log("i18n parity check FAILED");
  process.exit(1);
}
console.log("i18n parity check PASSED");
