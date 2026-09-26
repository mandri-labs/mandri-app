import { ChipPopover, type ChipPopoverProps } from "./ChipPopover";
import { ModelMenu, type ModelMenuProps } from "./ModelMenu";

type ModelPopoverProps = ModelMenuProps &
  Pick<ChipPopoverProps, "anchorRef" | "onClose" | "placement">;

/** Shared model picker surface for session composers and default preferences. */
export function ModelPopover({ anchorRef, onClose, placement, ...menu }: ModelPopoverProps) {
  return (
    <ChipPopover anchorRef={anchorRef} onClose={onClose} placement={placement}>
      <ModelMenu {...menu} />
    </ChipPopover>
  );
}
