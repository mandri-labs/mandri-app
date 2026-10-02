import { Circle, CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import type { TranscriptPlanStep, TranscriptPlanStepStatus } from "../parse/types";
import "./renderers.css";

export type PlanStepStatus = TranscriptPlanStepStatus;
export type PlanStep = TranscriptPlanStep;

export interface PlanStepsProps {
  steps: PlanStep[];
}

function stepIcon(status: PlanStepStatus): ReactElement {
  switch (status) {
    case "done":
      return <CircleCheck size={14} aria-hidden="true" />;
    case "running":
      return <LoaderCircle size={14} className="tr-spin" aria-hidden="true" />;
    case "waiting":
      return <Circle size={14} aria-hidden="true" />;
    case "cancelled":
      return <CircleX size={14} aria-hidden="true" />;
  }
}

export function PlanSteps({ steps }: PlanStepsProps) {
  return (
    <div className="tr-plan">
      {steps.map((step, index) => (
        <div key={index} className={`tr-plan-step tr-plan-step-${step.status}`}>
          <span className="tr-plan-icon">{stepIcon(step.status)}</span>
          <span>{step.text}</span>
        </div>
      ))}
    </div>
  );
}
