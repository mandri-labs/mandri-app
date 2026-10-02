import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const ShellHeaderActionsContext = createContext<HTMLElement | null>(null);

export function ShellHeaderActions({ children }: { children: ReactNode }) {
  const target = useContext(ShellHeaderActionsContext);
  return target ? createPortal(children, target) : children;
}
