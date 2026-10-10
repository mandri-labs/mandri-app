import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export function Arguments({
  args,
  onChange,
}: {
  args: string[];
  onChange: (args: string[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mcp-secret-fields">
      <span className="providers-field-label">{t("core.mcp.args")}</span>
      {args.map((arg, index) => (
        <div className="mcp-secret-row" key={index}>
          <input
            className="providers-input"
            value={arg}
            aria-label={`${t("core.mcp.args")} ${index + 1}`}
            spellCheck={false}
            onChange={(event) =>
              onChange(args.map((value, i) => (i === index ? event.target.value : value)))
            }
          />
          <button
            type="button"
            className="mcp-icon-button"
            aria-label={t("core.mcp.remove")}
            onClick={() => onChange(args.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="mcp-icon-button"
        aria-label={t("core.mcp.add_argument")}
        onClick={() => onChange([...args, ""])}
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
