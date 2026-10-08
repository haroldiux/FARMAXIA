import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShellGate } from "./components/app-shell";
import { themeBootScript } from "./lib/theme-script";
import "./globals.css";
// Rediseño Bento del sistema interno (solo aplica dentro de .app-shell, nunca al login).
import "./bento.css";
// Login, registro y login de plataforma (solo aplica a .lx-page).
import "./login.css";

export const metadata: Metadata = {
  title: "FARMAXIA · Operación inteligente",
  description: "Backoffice multi-tenant para farmacias"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // suppressHydrationWarning: el script de tema pone data-theme antes de que React cargue.
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body><AppShellGate>{children}</AppShellGate></body>
    </html>
  );
}
