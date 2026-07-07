"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

/**
 * AppHeader - the shared, responsive top bar for every authenticated page.
 *
 * Above 860px the page-specific actions render inline; below it they collapse
 * into a burger menu so the header never overflows on phones/tablets. The brand
 * links home; Sign out is always the last action. The About / Terms links live
 * in the footer (AppFooter), not here.
 */

export type HeaderAction =
  | { kind: "link"; label: string; href: string; icon?: React.ReactNode; primary?: boolean }
  | { kind: "button"; label: string; onClick: () => void; icon?: React.ReactNode; primary?: boolean };

export default function AppHeader({
  title = "BreakAid Gameplan",
  actions = [],
}: {
  title?: string;
  actions?: HeaderAction[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close the menu on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const signOut = async () => {
    await supabase?.auth.signOut();
    router.replace("/login");
    router.refresh();
  };

  // Page actions first, then Sign out (always last). About / Terms are in the footer.
  const items: HeaderAction[] = [
    ...actions,
    { kind: "button", label: "Sign out", onClick: signOut, icon: <LogOut size={18} /> },
  ];

  const renderItem = (item: HeaderAction, i: number) => {
    const cls = `app-nav-btn${item.primary ? " app-nav-btn--primary" : ""}`;
    const inner = (
      <>
        {item.icon}
        {item.label}
      </>
    );
    if (item.kind === "link") {
      return (
        <Link key={i} href={item.href} className={cls} onClick={() => setOpen(false)}>
          {inner}
        </Link>
      );
    }
    return (
      <button
        key={i}
        type="button"
        className={cls}
        onClick={() => {
          setOpen(false);
          item.onClick();
        }}
      >
        {inner}
      </button>
    );
  };

  return (
    <header className="app-header">
      <Link href="/" className="app-header__brand" aria-label="Go to home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://upload.wikimedia.org/wikipedia/commons/5/59/Costco_Wholesale_logo_2010-10-26.svg"
          alt="Costco Wholesale"
          className="app-header__logo"
        />
        <span className="app-header__title">{title}</span>
      </Link>

      {/* Desktop inline actions */}
      <nav className="app-header__actions">{items.map(renderItem)}</nav>

      {/* Mobile burger */}
      <button
        type="button"
        className="app-header__burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>

      {open && <div className="app-header__menu">{items.map(renderItem)}</div>}
    </header>
  );
}
