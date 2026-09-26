import {
  FileCheck2,
  Hand,
  ListChecks,
  LockKeyhole,
  Shield,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { HarnessKind } from "@/daemon/types/ws";
import { permissionTone } from "./permissionModes";

export function PermissionModeIcon({
  harness,
  mode,
  size = 14,
}: {
  harness: HarnessKind;
  mode: string;
  size?: number;
}) {
  const tone = permissionTone(harness, mode);
  const Icon =
    tone === "danger"
      ? ShieldAlert
      : tone === "amber"
        ? ShieldCheck
        : mode === "plan"
          ? ListChecks
          : mode === "acceptEdits"
            ? FileCheck2
            : mode === "dontAsk"
              ? LockKeyhole
              : mode === "ask" || mode === "default" || mode === "manual"
                ? Hand
                : Shield;
  return <Icon size={size} aria-hidden="true" />;
}
