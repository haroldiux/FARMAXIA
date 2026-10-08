"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellSession } from "./app-shell";

interface CustomersLink {
  href: string;
  label: string;
  /** Plan feature that unlocks the section (locked links show the plan label). */
  feature?: string;
  planLabel?: string;
  /** The link shows when the user holds any of these permissions. */
  permissions: string[];
}

const links: CustomersLink[] = [
  { href: "/customers", label: "Clientes", permissions: ["customers.manage"] },
  { href: "/customers/loyalty", label: "Puntos", feature: "crm.loyalty", planLabel: "Profesional", permissions: ["loyalty.manage"] },
  { href: "/customers/agreements", label: "Convenios", feature: "crm.agreements", planLabel: "Premium", permissions: ["agreements.manage", "agreements.billing"] },
  { href: "/customers/statements", label: "Estados de cuenta", feature: "crm.agreements", planLabel: "Premium", permissions: ["agreements.billing"] }
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/customers") return pathname === "/customers";
  return pathname.startsWith(href);
}

/** Navegación entre las pantallas de clientes; puntos y convenios se bloquean si el plan no los incluye. */
export function CustomersNav() {
  const pathname = usePathname();
  const shell = useShellSession();
  const permissions = shell?.session.permissions ?? [];
  // Sin datos de suscripción cargados no se bloquea nada; la API igual responde 403 si el plan no lo incluye.
  const enabled = (feature?: string) => !feature || !shell?.subscription || shell.subscription.features.some((item) => item.code === feature && item.enabled);
  return (
    <nav className="inventory-subnav no-print" aria-label="Secciones de clientes">
      {links.filter((link) => link.permissions.some((permission) => permissions.includes(permission))).map((link) => {
        if (!enabled(link.feature)) {
          return <span aria-disabled="true" className="controlled-nav-locked" key={link.href} title={`Requiere el plan ${link.planLabel}`}>{link.label} · {link.planLabel}</span>;
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
