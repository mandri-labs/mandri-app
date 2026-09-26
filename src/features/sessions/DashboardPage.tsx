import type { ProtectionChoice } from "@/daemon/protection";
import { WelcomeComposer } from "./WelcomeComposer";
import "./dashboard.css";

export function DashboardPage({ initialCwd, initialProtection }: { initialCwd?: string; initialProtection?: ProtectionChoice } = {}) {
  return (
    <div className="dashboard">
      <div className="dashboard-welcome">
        <WelcomeComposer initialCwd={initialCwd} initialProtection={initialProtection} />
      </div>
    </div>
  );
}
