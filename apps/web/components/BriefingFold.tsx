"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { briefing as copy } from "@/lib/copy";

const STORAGE_KEY = "airdropiq:briefing-collapsed";

/**
 * The frame of the briefing box: a heading and a button that folds the body away. The state is remembered in
 * localStorage; every access is wrapped in try/catch because storage can be blocked or throw (private window, cleared
 * site data), and the box works the same without it (it starts open).
 */
export function BriefingFold({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // Storage is blocked: the box stays open.
    }
  }, []);

  const toggle = (): void => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Not remembered, still works for this visit.
    }
  };

  return (
    <section className="briefing" aria-labelledby={`${id}-title`}>
      <div className="briefing-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <button type="button" className="briefing-toggle" aria-expanded={!collapsed} aria-controls={`${id}-body`} onClick={toggle}>
          {collapsed ? copy.expand : copy.collapse}
        </button>
      </div>
      <div id={`${id}-body`} className="briefing-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
