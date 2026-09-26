import type { Key, ReactNode } from "react";
import { Plus } from "lucide-react";
import "./collection-panel.css";

interface CollectionPanelProps<T> {
  label: string;
  items: readonly T[];
  getKey: (item: T) => Key;
  renderItem: (item: T) => ReactNode;
  isSelected?: (item: T) => boolean;
  emptyMessage?: string;
  addLabel: string;
  onAdd: () => void;
  editor?: ReactNode;
}

export function CollectionPanel<T>({
  label,
  items,
  getKey,
  renderItem,
  isSelected,
  emptyMessage,
  addLabel,
  onAdd,
  editor,
}: CollectionPanelProps<T>) {
  return (
    <div className="collection-panel">
      {items.length > 0 ? (
        <ul className="collection-panel-list" aria-label={label}>
          {items.map((item) => (
            <li
              key={getKey(item)}
              className={`collection-panel-item${isSelected?.(item) ? " collection-panel-item--selected" : ""}`}
            >
              {renderItem(item)}
            </li>
          ))}
        </ul>
      ) : emptyMessage ? (
        <p className="collection-panel-empty">{emptyMessage}</p>
      ) : null}
      <div className="collection-panel-footer">
        {editor ?? (
          <button type="button" className="collection-panel-add" onClick={onAdd}>
            <Plus size={16} aria-hidden="true" />
            {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}
