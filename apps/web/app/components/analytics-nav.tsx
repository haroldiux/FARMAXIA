"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { planAllows } from "../lib/plan";
import { useShellSession } from "./app-shell";

interface AnalyticsLink {
  href: string;
  label: string;
  /** Plan feature that unlocks the section (locked links show the plan label). */
  feature?: string;
  planLabel?: string;
}

export const analyticsLinks: AnalyticsLink[] = [
  { href: "/analytics", label: "Panel" },
  { href: "/analytics/abc", label: "ABC", feature: "analytics.abc", planLabel: "Premium" },
  { href: "/analytics/rotation", label: "Rotación", feature: "analytics.profitability", planLabel: "Profesional" },
  { href: "/analytics/profitability", label: "Rentabilidad", feature: "analytics.profitability", planLabel: "Profesional" },
  { href: "/analytics/stockouts", label: "Quiebres", feature: "analytics.profitability", planLabel: "Profesional" }
];

function isActive(href: string, pathname: string): boolean {
  if (href === "/analytics") return pathname === "/analytics";
  return pathname.startsWith(href);
}

/** Navegación entre las pantallas de analítica; las que el plan no incluye se muestran bloqueadas. */
export function AnalyticsNav() {
  const pathname = usePathname();
  const shell = useShellSession();
  // Sin datos de suscripción cargados no se bloquea nada; la API igual responde 403 si el plan no lo incluye.
  const features = shell?.subscription?.features;
  return (
    <nav className="inventory-subnav no-print" aria-label="Secciones de analítica">
      {analyticsLinks.map((link) => {
        if (link.feature && !planAllows(features, link.feature)) {
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
