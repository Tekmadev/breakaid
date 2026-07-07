import React from "react";
import Link from "next/link";
import { Heart } from "lucide-react";

/**
 * AppFooter - the slim footer shown at the bottom of the authenticated app
 * pages. It carries the legal links (About, Terms & Privacy) the way sites
 * usually do: set apart from the top navigation, quiet and out of the way, plus
 * a "Made with love" signature line.
 */
export default function AppFooter() {
  return (
    <footer className="app-footer">
      <span className="app-footer__note">
        <span>BreakAid Gameplan · Built for a single Costco warehouse</span>
        <span className="app-footer__love">
          Made with <Heart size={12} className="app-footer__heart" aria-label="love" /> by Kazi
          Shajeedul Islam
        </span>
      </span>
      <nav className="app-footer__links">
        <Link href="/about">About</Link>
        <span className="app-footer__sep" aria-hidden>·</span>
        <Link href="/terms">Terms &amp; Privacy</Link>
      </nav>
    </footer>
  );
}
