import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Kalėdinis konkursas | Gera dovana",
  description: "Gera dovana kviečia atrasti savo kalėdinę staigmeną.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="lt">
      <body>{children}</body>
    </html>
  );
}

