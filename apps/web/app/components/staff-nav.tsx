"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellSession } from "./app-shell";

interface StaffLink {
  href: string;
  label: string;
  /** Plan feature that unlocks the section (locked links show the plan label). */
  feature?: string;
  planLabel?: string;
  /** Permission needed to see the link at all; omitted for sections every member can open. */
  permission?: string;
}

const links: StaffLink[] = [
  { href: "/staff", label: "Turnos", feature: "staff.shifts", planLabel: "Profesional" },
  { href: "/staff/commissions", label: "Comisiones", feature: "staff.commissions", planLabel: "Profesional" },
  { href: "/staff/productivity", label: "Productividad", permission: "staff.reports.read" }
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/staff") return pathname === "/staff";
  return pathname.startsWith(href);
}

/** Navegación entre las pantallas de personal; turnos y comisiones se bloquean si el plan no los incluye. */
export function StaffNav() {
  const pathname = usePathname();
  const shell = useShellSession();
  const permissions = shell?.session.permissions ?? [];
  // Sin datos de suscripción cargados no se bloquea nada; la API igual responde 403 si el plan no lo incluye.
  const enabled = (feature?: string) => !feature || !shell?.subscription || shell.subscription.features.some((item) => item.code === feature && item.enabled);
  return (
    <nav className="inventory-subnav no-print" aria-label="Secciones de personal">
      {links.filter((link) => !link.permission || permissions.includes(link.permission)).map((link) => {
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
