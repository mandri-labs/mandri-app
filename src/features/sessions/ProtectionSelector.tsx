import type { ProtectionChoice } from "@/daemon/protection";
import { ProtectionMenu } from "./ProtectionMenu";

export function ProtectionSelector({
  value,
  onChange,
}: {
  value: ProtectionChoice;
  indicator?: "radio" | "check";
  onChange: (choice: ProtectionChoice) => void;
}) {
  return <ProtectionMenu value={value} onSelect={onChange} />;
}
