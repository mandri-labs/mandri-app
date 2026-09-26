import { CircleAlert, Info, Minimize2, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import "./renderers.css";

export type SystemBannerLevel = "info" | "warning" | "error";

export interface SystemBannerProps {
  level: SystemBannerLevel;
  text: string;
  compacted?: boolean;
}

function bannerIcon(level: SystemBannerLevel): ReactElement {
  switch (level) {
    case "info":
      return <Info size={14} aria-hidden="true" />;
    case "warning":
      return <TriangleAlert size={14} aria-hidden="true" />;
    case "error":
      return <CircleAlert size={14} aria-hidden="true" />;
  }
}

export function SystemBanner({ level, text, compacted }: SystemBannerProps) {
  return (
    <div className={`tr-banner tr-banner-${level}`} role={level === "error" ? "alert" : "status"}>
      {compacted ? <Minimize2 size={14} aria-hidden="true" /> : bannerIcon(level)}
      <span>{text}</span>
    </div>
  );
}
