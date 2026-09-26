import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TranscriptNode } from "../parse/types";
import { Disclosure, DisclosureKeyContext } from "./Disclosure";
import { consolidateFiles } from "../fileChanges";
import { DiffCard } from "./DiffCard";

export const ChangedFiles = memo(function ChangedFiles({
  nodes,
  scope = "changed-files",
}: {
  nodes: readonly TranscriptNode[];
  scope?: string;
}) {
  const { t } = useTranslation();
  const files = useMemo(() => consolidateFiles(nodes), [nodes]);
  if (files.length === 0) return null;
  return (
    <DisclosureKeyContext.Provider value={scope}>
      <Disclosure
        className="tr-changed-files"
        title={t(scope === "files:session" ? "core.transcript.session_files_changed" : "core.transcript.files_changed", { count: files.length })}
      >
        {files.map((file) => (
          <DisclosureKeyContext.Provider key={file.path} value={`${scope}:${file.path}`}>
            <DiffCard {...file} />
          </DisclosureKeyContext.Provider>
        ))}
      </Disclosure>
    </DisclosureKeyContext.Provider>
  );
});
