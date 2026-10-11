import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "dark" | "danger";

type Common = { variant: ButtonVariant; children: ReactNode };
type AsLink = Common & { href: string };
type AsButton = Common & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { href?: undefined };

/**
 * primary = green fill (the main action, site-wide), danger = red outline (stop, remove, delete), secondary = outline
 * only, dark = black fill. All have a 3 px border and capital letters. Pass `href` to get a link that looks the same; otherwise it is a native button.
 */
export function Button(props: AsLink | AsButton) {
  if (props.href !== undefined) {
    const { variant, children, href } = props;
    return (
      <Link href={href} className="ui-button" data-variant={variant}>
        {children}
      </Link>
    );
  }
  const { variant, children, ...rest } = props;
  return (
    <button {...rest} className="ui-button" data-variant={variant}>
      {children}
    </button>
  );
}
