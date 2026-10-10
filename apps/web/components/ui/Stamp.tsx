export type StampTone = "pass" | "ended" | "caution";
export type StampSize = "sm" | "md" | "lg";

const MAX_ROTATION = 10;

/** Keeps a stamp tilted a little, never more than 10 degrees either way; anything that is not a number sits flat. */
function clampRotation(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return Math.min(MAX_ROTATION, Math.max(-MAX_ROTATION, degrees));
}

/**
 * A ringed stamp ("LOLOS 4/4 CEK", "ENDED"). Colour comes from the tone, ring width from the size. `note` adds a small
 * third line ("ATAU GAK TAMPIL").
 */
export function Stamp({
  top,
  bottom,
  note,
  tone,
  size,
  rotate,
}: {
  top: string;
  bottom: string;
  note?: string;
  tone: StampTone;
  size: StampSize;
  rotate: number;
}) {
  return (
    <span
      className="ui-stamp"
      role="img"
      aria-label={[top, bottom, note].filter(Boolean).join(" ")}
      data-tone={tone}
      data-size={size}
      style={{ transform: `rotate(${clampRotation(rotate)}deg)` }}
    >
      <span className="ui-stamp-top" aria-hidden="true">
        {top}
      </span>
      {bottom ? (
        <span className="ui-stamp-bottom" aria-hidden="true">
          {bottom}
        </span>
      ) : null}
      {note ? (
        <span className="ui-stamp-note" aria-hidden="true">
          {note}
        </span>
      ) : null}
    </span>
  );
}
