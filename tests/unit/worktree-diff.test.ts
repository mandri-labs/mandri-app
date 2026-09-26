import { expect, it } from "vitest";
import { parseWorktreeDiff } from "@/features/sessions/worktreeDiff";

it("numbers both sides across hunks without counting headers or newline markers as edits", () => {
  const [file] = parseWorktreeDiff(
    `diff --git a/src/hello.ts b/src/hello.ts
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -4,3 +4,4 @@
 context
-before
+after
+extra
 last
@@ -20 +21 @@
-old
+new
\\ No newline at end of file
`,
    ["src/hello.ts"],
  );
  expect(file?.additions).toBe(3);
  expect(file?.deletions).toBe(2);
  expect(file?.hunks[0]?.lines).toEqual([
    { kind: "context", text: "context", oldNumber: 4, newNumber: 4 },
    { kind: "del", text: "before", oldNumber: 5 },
    { kind: "add", text: "after", newNumber: 5 },
    { kind: "add", text: "extra", newNumber: 6 },
    { kind: "context", text: "last", oldNumber: 6, newNumber: 7 },
  ]);
  expect(file?.hunks[1]?.lines).toEqual([
    { kind: "del", text: "old", oldNumber: 20 },
    { kind: "add", text: "new", newNumber: 21 },
    { kind: "note", text: "No newline at end of file" },
  ]);
});

it("preserves added, deleted, renamed, binary and mode-only files", () => {
  const files = parseWorktreeDiff(
    `diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/deleted.txt b/deleted.txt
deleted file mode 100644
--- a/deleted.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.txt b/new name.txt
similarity index 100%
rename from old name.txt
rename to new name.txt
diff --git a/image.png b/image.png
index aaa..bbb 100644
Binary files a/image.png and b/image.png differ
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`,
    ["new.txt", "deleted.txt", "old name.txt", "new name.txt", "image.png", "run.sh"],
  );
  expect(files.map((file) => [file.path, file.status])).toEqual([
    ["new.txt", "added"],
    ["deleted.txt", "deleted"],
    ["new name.txt", "renamed"],
    ["image.png", "modified"],
    ["run.sh", "modified"],
  ]);
  expect(files[0]?.hunks[0]?.lines[0]?.newNumber).toBe(1);
  expect(files[1]?.hunks[0]?.lines[0]?.oldNumber).toBe(1);
  expect(files[2]?.previousPath).toBe("old name.txt");
  expect(files[3]?.binary).toBe(true);
  expect(files[4]?.modeChange).toBe("100644 → 100755");
});

it("preserves valid files alongside a malformed patch and missing previews", () => {
  const files = parseWorktreeDiff(
    `diff --git a/broken.txt b/broken.txt
--- a/broken.txt
+++ b/broken.txt
@@ -1,5 +1,5 @@
-truncated
diff --git a/good.txt b/good.txt
--- a/good.txt
+++ b/good.txt
@@ -1 +1 @@
-before
+after
`,
    ["broken.txt", "good.txt", "missing.txt"],
  );
  expect(files.find((file) => file.path === "good.txt")?.additions).toBe(1);
  expect(files.find((file) => file.path === "broken.txt")?.unavailable).toBe(true);
  expect(files.find((file) => file.path === "missing.txt")?.unavailable).toBe(true);
  expect(parseWorktreeDiff("", [])).toEqual([]);
});
