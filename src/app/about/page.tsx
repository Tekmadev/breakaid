import React from "react";
import type { Metadata } from "next";
import LegalHeader from "@/components/LegalHeader";

export const metadata: Metadata = {
  title: "About · BreakAid Gameplan",
  description: "About BreakAid, built by a Costco employee to make the door gameplan effortless.",
};

export default function AboutPage() {
  return (
    <div className="animate-fade-in" style={{ minHeight: "100vh" }}>
      <LegalHeader />
      <main className="legal-page">
        <h1>About BreakAid</h1>
        <p style={{ fontSize: "1.05rem", color: "var(--text-primary)" }}>
          BreakAid was created by <strong>Kazi Shajeedul Islam</strong>, a Software Development
          graduate and one of your own Costco team members (<strong>Employee #52652172</strong>), for
          the people who run the front door every day.
        </p>

        <h2>Why it exists</h2>
        <p>
          Every morning the Member Service gameplan used to be written out by hand: who is on the
          door, who walks, who breaks and when, who covers security at close. It took time, it was
          easy to get wrong, and it had to be redone from scratch each day. BreakAid turns that daily
          task into a few clicks, producing a fair, consistent plan in seconds so the team can spend
          its energy on members instead of paperwork.
        </p>

        <h2>The work behind it</h2>
        <p>
          None of this happened by accident. Every rule you rely on, including the break spacing, the
          hourly walks, the security hand-offs, the push after close, and the fair rotation that gives
          everyone an even share of the entrance and the exit, was studied on the floor, tested
          against real days, and refined over countless hours of careful, detailed work. It reflects
          real skill and a deep commitment to making the door team&apos;s shift run smoother and fairer
          for everyone.
        </p>

        <h2>A note to managers</h2>
        <p>
          BreakAid was designed to save you time every morning and take one worry off your plate.
          A great deal of thought, planning, and engineering went into every corner of it, and it was
          built to serve this warehouse&apos;s door team well. Please use it with the same care it was
          made with.
        </p>

        <h2>Contact</h2>
        <p>
          Questions, feedback, or anything at all, reach out to Kazi Shajeedul Islam at{" "}
          <a href="mailto:shajeed@tekmadev.com" style={{ color: "var(--accent-secondary)" }}>
            shajeed@tekmadev.com
          </a>
          .
        </p>

        <p style={{ marginTop: "2rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
          Built for a single Costco warehouse. Not affiliated with or endorsed by Costco Wholesale
          Corporation. See the{" "}
          <a href="/terms" style={{ color: "var(--accent-secondary)" }}>
            Terms &amp; Privacy
          </a>{" "}
          page for licensing and data details.
        </p>
      </main>
    </div>
  );
}
