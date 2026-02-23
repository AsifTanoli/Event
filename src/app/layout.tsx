import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Event",
  description: "Event registration form",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
