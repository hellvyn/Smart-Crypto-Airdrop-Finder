import type { HTMLAttributes, ReactNode } from "react";

export type TagTone = "verified" | "reported" | "plain" | "claimOpen" | "warn";

/**
 * A small label. verified = green outline, reported = dashed, claimOpen = black fill, warn = peach fill. Other span
 * attributes (data-*) pass through.
 */
export function Tag({
  tone,
  children,
  ...rest
}: { tone: TagTone; children: ReactNode } & Omit<HTMLAttributes<HTMLSpanElement>, "className" | "children">) {
  return (
    <span {...rest} className="ui-tag" data-tone={tone}>
      {children}
    </span>
  );
}
