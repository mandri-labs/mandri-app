import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { openCanvas } from "@/features/canvas/store";
import { fileTarget, isLocalReference } from "@/features/canvas/targets";
export function isSessionFile(href: string): boolean {
  return !href.startsWith("#") && !href.startsWith("?") && isLocalReference(href);
}
export function SessionFileLink({
  sessionId,
  href,
  children,
  basePath,
  compact = false,
}: {
  sessionId: string;
  href: string;
  children: ReactNode;
  basePath?: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  return (
    <>
      <a
        href={href}
        className={compact ? "canvas-attachment" : undefined}
        onClick={(event) => {
          event.preventDefault();
          try {
            openCanvas(sessionId, fileTarget(href, basePath));
            setError(false);
          } catch {
            setError(true);
          }
        }}
      >
        {compact && <FileText size={24} />}
        {children}
      </a>
      {error && <span role="alert">{t("core.attachments.unavailable")}</span>}
    </>
  );
}
