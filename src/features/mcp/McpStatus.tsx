import { CircleCheck, CirclePause, LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { McpServer } from "@/daemon/rest/mcp";

export function McpStatus({ state }: { state: McpServer["state"] }) {
  const { t } = useTranslation();
  const Icon =
    state === "ready"
      ? CircleCheck
      : state === "disabled"
        ? CirclePause
        : state === "starting" || state === "reconnecting"
          ? LoaderCircle
          : TriangleAlert;
  return (
    <Icon
      size={16}
      className={`mcp-status mcp-status--${state}`}
      aria-label={t(`core.mcp.state.${state}`)}
    />
  );
}
