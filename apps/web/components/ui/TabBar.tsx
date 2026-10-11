import Link from "next/link";
import { ui } from "@/lib/copy";

export interface TabItem {
  label: string;
  count?: number;
  href: string;
  active: boolean;
}

/** Link tabs. The active one is black with an orange underline and carries aria-current="page". */
export function TabBar({ tabs }: { tabs: TabItem[] }) {
  return (
    <nav className="ui-tabbar" aria-label={ui.tabBarLabel}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className="ui-tab" aria-current={tab.active ? "page" : undefined}>
          {tab.count === undefined ? tab.label : `${tab.label} · ${tab.count}`}
        </Link>
      ))}
    </nav>
  );
}
