import React from "react";
import type { Metadata } from "next";
import LegalHeader from "@/components/LegalHeader";

export const metadata: Metadata = {
  title: "Terms & Privacy · BreakAid Gameplan",
  description: "Terms of use and privacy policy for the BreakAid Gameplan application.",
};

export default function TermsPage() {
  return (
    <div className="animate-fade-in" style={{ minHeight: "100vh" }}>
      <LegalHeader />
      <main className="legal-page">
        <h1>Terms of Use &amp; Privacy Policy</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Effective July 7, 2026</p>

        <p>
          This application (&ldquo;BreakAid&rdquo;, the &ldquo;App&rdquo;) is a private scheduling
          tool. By accessing or using the App you agree to these Terms of Use and Privacy Policy in
          full. If you do not agree, you must not access or use the App.
        </p>

        <h2>1. Single-warehouse license</h2>
        <p>
          The App is licensed for use by <strong>one single Costco Wholesale warehouse location
          only</strong>, being the specific warehouse for which access was granted. This license is
          limited, non-exclusive, non-transferable, and revocable, and is granted solely on the terms
          set out here and in any separate written agreement between the developer and the warehouse.
        </p>
        <p>
          Any use, deployment, installation, reproduction, distribution, or access of the App, or of
          the data within it, by, for, or on behalf of <strong>any other Costco location, warehouse,
          depot, region, division, or the broader Costco enterprise</strong>, or any third party, is
          strictly prohibited and constitutes a material breach of these Terms and an infringement of
          the developer&apos;s rights. Any such unauthorized use immediately and automatically
          terminates this license.
        </p>
        <p>
          <strong>Purchase, sharing, and enterprise use must be arranged with the developer in
          advance.</strong> Any acquisition or purchase of the App or its rights by Costco Wholesale
          Corporation or any of its entities, and any wish to extend, share, copy, or roll out the App
          to additional Costco locations, regions, or the Costco enterprise as a whole, is not covered
          by this license. Each of these must first be discussed and agreed directly with the
          developer, Kazi Shajeedul Islam, and requires a separate written agreement and a separate
          enterprise-level license on terms to be mutually agreed. No ownership, resale,
          redistribution, or multi-location rights are granted, implied, or transferred by use of the
          App.
        </p>

        <h2>2. Ownership</h2>
        <p>
          The App, including its scheduling logic, rules, layout, and design, is the exclusive
          intellectual property of its developer, <strong>Kazi Shajeedul Islam</strong> (Costco
          Employee #52652172), and is protected by applicable copyright and related laws. No ownership
          or rights are transferred to any user or warehouse by use of the App. The App is{" "}
          <strong>not affiliated with, sponsored by, or endorsed by Costco Wholesale Corporation</strong>.
          The &ldquo;Costco&rdquo; name and logo are used only to identify the workplace the tool
          serves and remain the property of their owner.
        </p>

        <h2>3. Authorized use</h2>
        <ul>
          <li>Access is restricted to authorized managers and staff of the licensed warehouse.</li>
          <li>Accounts are personal. Do not share your credentials or let others use your account.</li>
          <li>
            Manager (editor) accounts may build and finalize gameplans. Viewer accounts may only view
            them.
          </li>
          <li>
            You must not copy, export, publish, or share schedule data or gameplans outside the
            authorized door team of the licensed warehouse.
          </li>
        </ul>

        <h2>4. Data we collect and why</h2>
        <p>To operate the App, the following data is collected and stored:</p>
        <ul>
          <li>
            <strong>Account data:</strong> your email address, an encrypted (hashed) password, and
            your assigned role (manager or viewer). Used only to authenticate you and control access.
          </li>
          <li>
            <strong>Employee and scheduling data:</strong> employee display names, shift times,
            positions, and capability settings (can walk, can do security, entrance or exit
            restriction). Entered by managers or read from the weekly schedule file a manager uploads.
          </li>
          <li>
            <strong>Gameplan data:</strong> the generated and finalized daily plans, together with an
            audit record of which account created or last modified each plan and when.
          </li>
          <li>
            <strong>Uploaded schedule files:</strong> processed inside your browser to build the
            day&apos;s roster. The file itself is not uploaded to or retained on any server. Only the
            resulting roster and plan a manager chooses to save are stored.
          </li>
        </ul>
        <p>
          The App does <strong>not</strong> collect payment information, government identifiers, member
          data, precise location, or any sensitive personal data beyond the work-schedule information
          described above.
        </p>

        <h2>5. How data is stored and protected</h2>
        <p>
          Data is stored in a private database protected by row-level security, with access limited to
          authenticated accounts of the licensed warehouse. Data is used <strong>only</strong> to
          operate the scheduling tool for that warehouse, and is never sold, rented, or shared with
          advertisers or unrelated third parties. Data is retained until deleted by an authorized
          manager or the developer.
        </p>

        <h2>6. Confidentiality</h2>
        <p>
          Employee names, shifts, and gameplans are confidential workplace information. Users must
          keep this information confidential and use it only for operating the door schedule at the
          licensed warehouse.
        </p>

        <h2>7. No warranty; scheduling aid only</h2>
        <p>
          The App is provided on an <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;
          basis, without warranty of any kind</strong>, express or implied. The generated gameplan is
          a scheduling aid. Authorized managers remain solely responsible for final staffing decisions
          and for compliance with all applicable break, labor, safety, and company policies.
        </p>

        <h2>8. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, the developer shall not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or for any loss arising from the
          use of, or inability to use, the App, including any staffing, coverage, or scheduling
          outcome.
        </p>

        <h2>9. Changes and termination</h2>
        <p>
          The developer may update these Terms, or suspend or terminate access, at any time. Continued
          use of the App after a change constitutes acceptance of the updated Terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          Questions about these Terms or the data described here should be directed to the developer,
          Kazi Shajeedul Islam (Costco Employee #52652172), at{" "}
          <a href="mailto:shajeed@tekmadev.com" style={{ color: "var(--accent-secondary)" }}>
            shajeed@tekmadev.com
          </a>
          .
        </p>
      </main>
    </div>
  );
}
