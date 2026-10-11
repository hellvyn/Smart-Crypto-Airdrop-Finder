import { list } from "@/lib/copy";
import { logoLetter, logoPath, logoTone, type LogoSource } from "@/lib/view";

/** Rendered size of a card logo, in CSS pixels (fixed, so the card does not shift while it loads). */
const SIZE = 48;

/**
 * A project's logo on its card: the stored image from our own route (`/logo/{id}`, so the visitor's browser never
 * contacts a project domain), or without one a tile with the name's first letter on a colour picked from the slug.
 * The tile is hidden from screen readers: the name is right next to it.
 */
export function ProjectLogo({
  id,
  slug,
  name,
  source,
}: {
  id: string;
  slug: string;
  name: string;
  source: LogoSource | null;
}) {
  if (source !== null) {
    return (
      // A plain <img>: next/image would re-encode the bytes through its optimizer; the route already caches them.
      <img className="project-logo" src={logoPath(id)} alt={list.logoAlt(name)} width={SIZE} height={SIZE} loading="lazy" decoding="async" />
    );
  }
  return (
    <span className="project-logo project-logo-tile" data-testid="logo-fallback" data-tone={logoTone(slug)} aria-hidden="true">
      {logoLetter(name)}
    </span>
  );
}
