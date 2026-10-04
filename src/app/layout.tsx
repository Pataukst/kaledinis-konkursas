import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Kalėdinė dovana",
  description: "Pasirinkite savo kalėdinę dovaną.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="lt">
      <body>{children}</body>
    </html>
  );
}
