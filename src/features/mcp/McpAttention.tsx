import { useTranslation } from "react-i18next";
import { useStore } from "@/app/useStore";
import { mcpStore, mcpNeedsAttention } from "@/stores/mcp";

export function McpAttention() {
  const { t } = useTranslation();
  const attention = useStore(mcpStore, mcpNeedsAttention);
  return attention ? (
    <span className="mcp-nav-attention" role="img" aria-label={t("core.mcp.attention")} />
  ) : null;
}
