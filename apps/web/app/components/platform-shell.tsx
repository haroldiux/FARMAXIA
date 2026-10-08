"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { platformLogout, platformMe } from "../lib/platform";
import { setTheme, useTheme } from "../lib/theme";
import { initials } from "./app-shell";
import { NavIcon, type NavIconName } from "./nav-icon";

const navigation: Array<{ label: string; icon: NavIconName; href: string }> = [
  { label: "Resumen", icon: "overview", href: "/platform" },
  { label: "Farmacias", icon: "tenants", href: "/platform/tenants" },
  { label: "Pagos", icon: "billing", href: "/platform/payments" },
  { label: "Planes", icon: "plans", href: "/platform/plans" }
];

function isActive(pathname: string, href: string): boolean {
  return href === "/platform" ? pathname === href : pathname.startsWith(href);
}

/** Marco del panel de operador del SaaS (mismo diseño que el de la farmacia); valida el token de plataforma. */
export function PlatformShell({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const theme = useTheme();
  const [operator, setOperator] = useState<{ displayName: string; email: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    platformMe()
      .then(setOperator)
      .catch(() => {
        router.push("/platform/login");
      });
  }, [router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (!operator) {
    return <main className="center-state"><span className="loading-orb" />Comprobando sesión de operador…</main>;
  }

  return (
    <div className={`app-shell ax-shell platform-shell ${mobileOpen ? "is-menu-open" : ""}`}>
      <button aria-hidden="true" className="ax-backdrop" onClick={() => setMobileOpen(false)} tabIndex={-1} type="button" />
      <aside aria-label="Navegación de plataforma" className="ax-sidebar">
        <div className="ax-brand-row">
          <Link className="ax-brand" href="/platform">
            <span className="ax-brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
            <strong>FARMAXIA</strong>
          </Link>
          <button aria-label="Cerrar menú" className="ax-icon-button ax-close" onClick={() => setMobileOpen(false)} type="button"><NavIcon name="close" /></button>
        </div>
        <nav className="ax-nav">
          <div className="ax-nav-section">
            <p className="ax-nav-label">Plataforma</p>
            {navigation.map((item) => (
              <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} className={`ax-link ${isActive(pathname, item.href) ? "is-active" : ""}`} href={item.href} key={item.href}>
                <NavIcon name={item.icon} /><span>{item.label}</span>
              </Link>
            ))}
          </div>
        </nav>
        <div className="ax-promo">
          <span className="ax-promo-shape" aria-hidden="true" />
          <strong>Panel de operador</strong>
          <p>Farmacias, cobros y planes del SaaS.</p>
          <button className="ax-promo-button" onClick={platformLogout} type="button">Cerrar sesión</button>
        </div>
      </aside>
      <div className="app-content" data-alt-tone="blue" data-module="platform" data-tone="indigo">
        <header className="ax-topbar">
          <button aria-label="Abrir menú" className="ax-icon-button ax-menu-button" onClick={() => setMobileOpen(true)} type="button"><NavIcon name="menu" /></button>
          <div className="ax-user is-static">
            <span className="ax-avatar">{initials(operator.displayName)}</span>
            <span className="ax-user-text"><strong>{operator.displayName}</strong><small>{operator.email}</small></span>
          </div>
          <div className="ax-topbar-right">
            <button aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"} className="ax-icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} type="button">
              <NavIcon name={theme === "dark" ? "sun" : "moon"} />
            </button>
          </div>
        </header>
        <main className="dashboard-main">{children}</main>
      </div>
    </div>
  );
}
