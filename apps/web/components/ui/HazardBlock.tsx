import type { ReactNode } from "react";

/** A white panel inside an 8 px hazard frame. Used where something must not be mistaken for a normal row. */
export function HazardBlock({ children }: { children: ReactNode }) {
  return (
    <div className="ui-hazard-block">
      <div className="ui-hazard-panel">{children}</div>
    </div>
  );
}
