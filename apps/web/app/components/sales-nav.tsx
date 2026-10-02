"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellSession } from "./app-shell";

const links = [
  { href: "/sales", label: "Nueva venta", permission: "sales.confirm" },
  { href: "/sales/history", label: "Historial", permission: "sales.read" },
  { href: "/sales/quotes", label: "Proformas", permission: "sales.confirm" }
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/sales") return pathname === "/sales";
  if (href === "/sales/quotes") return pathname.startsWith("/sales/quotes");
  // El detalle y el recibo (/sales/<id>) cuelgan del historial.
  return pathname.startsWith("/sales/") && pathname !== "/sales/" && !pathname.startsWith("/sales/quotes");
}

/** Navegación entre las pantallas de ventas (cobro, historial y recibos). */
export function SalesNav() {
  const pathname = usePathname();
  const shell = useShellSession();
  const visible = links.filter((link) => !shell || shell.session.permissions.includes(link.permission));
  return (
    <nav className="inventory-subnav" aria-label="Secciones de ventas">
      {visible.map((link) => {
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
