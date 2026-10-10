import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface SecretEntry {
  id: string;
  name: string;
  value: string;
  stored: boolean;
}

export function secretEntries(keys: readonly string[]): SecretEntry[] {
  return keys.map((name) => ({ id: crypto.randomUUID(), name, value: "", stored: true }));
}

export function secretChanges(
  entries: readonly SecretEntry[],
  storedKeys: readonly string[],
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  const names = new Set<string>();
  for (const entry of entries) {
    const name = entry.name.trim();
    if (!name || names.has(name)) throw new Error("Invalid or duplicate name");
    names.add(name);
    if (!entry.stored || entry.value) changes[name] = entry.value;
  }
  for (const key of storedKeys) if (!names.has(key)) changes[key] = null;
  return changes;
}

export function SecretFields({
  label,
  entries,
  onChange,
  secret = true,
}: {
  label: string;
  entries: SecretEntry[];
  onChange: (entries: SecretEntry[]) => void;
  secret?: boolean;
}) {
  const { t } = useTranslation();
  const update = (id: string, changes: Partial<SecretEntry>) =>
    onChange(entries.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
  return (
    <div className="mcp-secret-fields">
      <span className="providers-field-label">{label}</span>
      {entries.map((entry) => (
        <div className="mcp-secret-row" key={entry.id}>
          <input
            className="providers-input"
            value={entry.name}
            aria-label={t("core.mcp.key")}
            placeholder={t("core.mcp.key")}
            onChange={(event) => update(entry.id, { name: event.target.value, stored: false })}
          />
          <input
            className="providers-input"
            value={entry.value}
            type={secret ? "password" : "text"}
            autoComplete="off"
            aria-label={t("core.mcp.value")}
            placeholder={entry.stored ? "********" : t("core.mcp.value")}
            onChange={(event) => update(entry.id, { value: event.target.value })}
          />
          <button
            type="button"
            className="mcp-icon-button"
            aria-label={t("core.mcp.remove")}
            onClick={() => onChange(entries.filter((row) => row.id !== entry.id))}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="mcp-icon-button"
        aria-label={t("core.mcp.add_field")}
        onClick={() =>
          onChange([
            ...entries,
            {
              id: crypto.randomUUID(),
              name: "",
              value: "",
              stored: false,
            },
          ])
        }
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
