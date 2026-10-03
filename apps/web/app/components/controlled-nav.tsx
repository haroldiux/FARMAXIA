"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellSession } from "./app-shell";

const links = [
  { href: "/controlled", label: "Recetas archivadas", premium: false },
  { href: "/controlled/balance", label: "Saldos mensuales", premium: true },
  { href: "/controlled/book", label: "Libro de controlados", premium: true }
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/controlled") {
    return pathname === "/controlled" || (pathname.startsWith("/controlled/") && !pathname.startsWith("/controlled/balance") && !pathname.startsWith("/controlled/book"));
  }
  return pathname.startsWith(href);
}

/** Navegación entre las pantallas de medicamentos controlados; saldos y libro requieren el plan Premium. */
export function ControlledNav() {
  const pathname = usePathname();
  const shell = useShellSession();
  // Sin datos de suscripción cargados no se oculta nada; la API igual responde 403 si el plan no lo incluye.
  const bookEnabled = !shell?.subscription || shell.subscription.features.some((feature) => feature.code === "controlled.book" && feature.enabled);
  return (
    <nav className="inventory-subnav no-print" aria-label="Secciones de medicamentos controlados">
      {links.map((link) => {
        if (link.premium && !bookEnabled) {
          return <span aria-disabled="true" className="controlled-nav-locked" key={link.href} title="Requiere el plan Premium">{link.label} · Premium</span>;
        }
        const active = isActive(link.href, pathname);
        return (
          <Link aria-current={active ? "page" : undefined} className={active ? "is-active" : ""} href={link.href} key={link.href}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
