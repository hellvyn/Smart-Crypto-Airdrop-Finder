/**
 * The AirdropIQ mark (owner 2026-10-11): a brain coming down on a parachute, an "airdrop" with a head on it. Square,
 * bold strokes so it reads at 34 px; the canopy takes the site's orange, the rest the ink colour.
 */
export function BrandMark() {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true" focusable="false" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {/* Canopy with a scalloped edge. */}
      <path d="M4 17C4 7.5 12.5 2.5 24 2.5S44 7.5 44 17q-5-4.5-10 0-5-4.5-10 0-5-4.5-10 0-5-4.5-10 0z" fill="var(--accent)" stroke="var(--ink)" strokeWidth="2.6" />
      <path d="M15 4.5c-2 3-3 7-2.4 11M33 4.5c2 3 3 7 2.4 11" stroke="var(--ink)" strokeWidth="1.6" />
      {/* Cords. */}
      <path d="M4 17 14 30M24 17v12.5M44 17 34 30" stroke="var(--ink)" strokeWidth="2" />
      {/* Brain: a bumpy cloud outline with the fold down the middle and two wrinkles on each side. */}
      <path
        d="M10.5 40.5a5 5 0 0 1 3.5-8 5 5 0 0 1 7-2.5 4.5 4.5 0 0 1 6 0 5 5 0 0 1 7 2.5 5 5 0 0 1 3.5 8 4.5 4.5 0 0 1-4.5 4.5h-1a4 4 0 0 1-6 0 4 4 0 0 1-6 0h-1a4.5 4.5 0 0 1-4.5-4.5z"
        fill="#fff"
        stroke="var(--ink)"
        strokeWidth="2.4"
      />
      <path d="M24 31c-2.5 2.5 2.5 4.5 0 7.5s2 4 0 6.5" stroke="var(--ink)" strokeWidth="1.8" />
      <path d="M15 36.5c2.2-.2 3.6 1 3.8 3M33 36.5c-2.2-.2-3.6 1-3.8 3M17 42c1.6-.4 2.8.2 3.4 1.4M31 42c-1.6-.4-2.8.2-3.4 1.4" stroke="var(--ink)" strokeWidth="1.6" />
    </svg>
  );
}
