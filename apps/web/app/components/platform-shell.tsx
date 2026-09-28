"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { platformLogout, platformMe } from "../lib/platform";
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

/** Marco del panel de operador del SaaS; valida el token de plataforma al entrar. */
export function PlatformShell({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [operator, setOperator] = useState<{ displayName: string; email: string } | null>(null);

  useEffect(() => {
    platformMe()
      .then(setOperator)
      .catch(() => {
        router.push("/platform/login");
      });
  }, [router]);

  if (!operator) {
    return <main className="center-state"><span className="loading-orb" />Comprobando sesión de operador…</main>;
  }

  return (
    <div className="app-shell platform-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">F</div>
          <div><strong>FARMAXIA</strong><span>panel de plataforma</span></div>
        </div>
        <div className="workspace-switcher">
          <span className="status-dot" />
          <div><small>Operador</small><strong className="operator-name">{operator.displayName}</strong></div>
        </div>
        <nav className="main-nav" aria-label="Navegación de plataforma">
          <p className="nav-label">Plataforma</p>
          {navigation.map((item) => (
            <Link aria-current={isActive(pathname, item.href) ? "page" : undefined} className={`nav-item ${isActive(pathname, item.href) ? "is-active" : ""}`} href={item.href} key={item.href}>
              <span className="nav-icon"><NavIcon name={item.icon} /></span><span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="secure-badge"><span>●</span> {operator.email}</div>
          <button className="logout-button" onClick={platformLogout} type="button">Cerrar sesión <NavIcon name="logout" /></button>
        </div>
      </aside>
      <main className="dashboard-main">{children}</main>
    </div>
  );
}
