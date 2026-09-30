"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/procurement", label: "Órdenes" },
  { href: "/procurement/receiving", label: "Recepción" },
  { href: "/procurement/invoices", label: "Facturas" },
  { href: "/procurement/payables", label: "Pagos" },
  { href: "/procurement/reorder", label: "Reposición" }
];

/** Navegación entre las pantallas del módulo de compras. */
export function ProcurementNav() {
  const pathname = usePathname();
  return (
    <nav className="inventory-subnav" aria-label="Secciones de compras">
      {links.map((link) => {
        const active = link.href === "/procurement" ? pathname === "/procurement" : pathname.startsWith(link.href);
        return (
          <Link aria-current={active ? "page" : undefined} className={active ? "is-active" : ""} href={link.href} key={link.href}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
