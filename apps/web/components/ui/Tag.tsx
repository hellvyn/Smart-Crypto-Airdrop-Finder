import type { ReactNode } from "react";

export type TagTone = "verified" | "reported" | "plain" | "claimOpen" | "warn";

/** A small label. verified = green outline, reported = dashed, claimOpen = black fill, warn = peach fill. */
export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return (
    <span className="ui-tag" data-tone={tone}>
      {children}
    </span>
  );
}
