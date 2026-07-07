import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * LegalHeader - a lightweight top bar for the public About / Terms pages.
 * These pages are reachable signed-in OR signed-out, so this header carries no
 * account actions - just the brand and a way back to the app.
 */
export default function LegalHeader() {
  return (
    <header className="app-header legal-header">
      <div className="app-header__brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://upload.wikimedia.org/wikipedia/commons/5/59/Costco_Wholesale_logo_2010-10-26.svg"
          alt="Costco Wholesale"
          className="app-header__logo"
        />
        <span className="app-header__title">BreakAid Gameplan</span>
      </div>
      <nav className="legal-nav">
        <Link href="/about" className="app-nav-btn">About</Link>
        <Link href="/terms" className="app-nav-btn">Terms &amp; Privacy</Link>
        <Link href="/" className="app-nav-btn app-nav-btn--primary">
          <ArrowLeft size={18} />
          Back to app
        </Link>
      </nav>
    </header>
  );
}
