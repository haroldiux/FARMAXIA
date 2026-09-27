"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/inventory", label: "Vencimientos y alertas" },
  { href: "/inventory/warehouses", label: "Almacenes" },
  { href: "/inventory/counts", label: "Inventario físico" },
  { href: "/inventory/waste-acts", label: "Actas de baja" },
  { href: "/inventory/reservations", label: "Reservas" }
];

/** Navegación entre las pantallas del módulo de inventario. */
export function InventoryNav() {
  const pathname = usePathname();
  return (
    <nav className="inventory-subnav" aria-label="Secciones de inventario">
      {links.map((link) => {
        const active = link.href === "/inventory" ? pathname === "/inventory" : pathname.startsWith(link.href);
        return (
          <Link aria-current={active ? "page" : undefined} className={active ? "is-active" : ""} href={link.href} key={link.href}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
