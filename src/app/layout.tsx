import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Costco BreakAid Manager",
  description: "Generate and manage member service gameplans efficiently.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
