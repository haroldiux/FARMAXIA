"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { accountProfile, type AccountProfile } from "../lib/account";
import { currentSession, logout, type AuthSession } from "../lib/session";
import { NavIcon, type NavIconName } from "./nav-icon";
import { ThemeToggle } from "./theme-toggle";

interface NavigationItem {
  label: string;
  icon: NavIconName;
  href: string;
  permission?: string;
}

// Secciones del menú. Solo se muestran las opciones para las que el usuario tiene permiso.
const sections: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "General", items: [{ label: "Resumen", icon: "overview", href: "/dashboard" }] },
  {
    label: "Operación",
    items: [
      { label: "Ventas POS", icon: "sales", href: "/sales", permission: "sales.confirm" },
      { label: "Caja y turnos", icon: "cash", href: "/cash", permission: "cash.manage" },
      { label: "Catálogo", icon: "catalog", href: "/catalog", permission: "catalog.manage" },
      { label: "Inventario", icon: "inventory", href: "/inventory", permission: "inventory.manage" },
      { label: "Compras", icon: "procurement", href: "/procurement", permission: "inventory.manage" }
    ]
  },
  {
    label: "Control",
    items: [
      { label: "Reporte global", icon: "report", href: "/inventory/report", permission: "inventory.report.global" },
      { label: "Auditoría", icon: "audit", href: "/audit", permission: "audit.read" }
    ]
  },
  {
    label: "Administración",
    items: [
      { label: "Usuarios y roles", icon: "users", href: "/users", permission: "users.manage" },
      { label: "Suscripción", icon: "billing", href: "/billing", permission: "billing.manage" },
      { label: "Mi cuenta", icon: "account", href: "/account" }
    ]
  }
];

/** Rutas del sistema interno de la farmacia: todas llevan el sidebar. */
const tenantRoutes = ["/dashboard", "/catalog", "/inventory", "/procurement", "/cash", "/sales", "/audit", "/users", "/billing", "/account"];

function isTenantRoute(pathname: string): boolean {
  return tenantRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/** La opción activa es la de ruta más larga que coincide (así /inventory/report no marca Inventario). */
function activeHref(pathname: string, items: NavigationItem[]): string | null {
  const matches = items.filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

interface ShellValue {
  session: AuthSession;
  account: AccountProfile | null;
}

const ShellContext = createContext<ShellValue | null>(null);

/** Sesión y cuenta que ya cargó el marco; evita pedirlas otra vez en cada página. */
export function useShellSession(): ShellValue | null {
  return useContext(ShellContext);
}

const COLLAPSED_KEY = "farmaxia-sidebar-collapsed";

/** Va en el layout raíz: envuelve con el sidebar solo las páginas internas. */
export function AppShellGate({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (!isTenantRoute(pathname)) {
    return <>{children}</>;
  }
  return <AppShell>{children}</AppShell>;
}

function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [value, setValue] = useState<ShellValue | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    currentSession()
      .then((session) => {
        if (!mounted) return;
        setValue({ session, account: null });
        accountProfile()
          .then((account) => mounted && setValue({ session, account }))
          .catch(() => undefined);
      })
      .catch(() => {
        if (mounted) router.replace("/");
      });
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Sin almacenamiento: el sidebar arranca expandido.
    }
    return () => {
      mounted = false;
    };
  }, [router]);

  // En celular el menú se cierra al cambiar de página o con Escape.
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function toggleCollapsed(): void {
    setCollapsed((current) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1");
      } catch {
        // El cambio dura hasta recargar.
      }
      return !current;
    });
  }

  async function signOut(): Promise<void> {
    await logout();
    router.replace("/");
  }

  if (!value) {
    return <main className="center-state"><span className="loading-orb" />Comprobando sesión…</main>;
  }

  const { session, account } = value;
  const visibleSections = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.permission || session.permissions.includes(item.permission)) }))
    .filter((section) => section.items.length > 0);
  const current = activeHref(pathname, visibleSections.flatMap((section) => section.items));
  const displayName = account?.displayName ?? "Usuario";

  return (
    <ShellContext.Provider value={value}>
      <div className={`app-shell tenant-shell ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "is-menu-open" : ""}`}>
        <header className="mobile-topbar">
          <button aria-expanded={mobileOpen} aria-label="Abrir menú" className="icon-button" onClick={() => setMobileOpen(true)} type="button"><NavIcon name="menu" /></button>
          <Link className="mobile-brand" href="/dashboard"><span className="brand-mark">F</span><strong>FARMAXIA</strong></Link>
          <ThemeToggle className="theme-toggle-icon" />
        </header>
        <button aria-hidden="true" className="sidebar-backdrop" onClick={() => setMobileOpen(false)} tabIndex={-1} type="button" />

        <aside aria-label="Menú principal" className="sidebar">
          <div className="sidebar-top">
            <Link className="brand-lockup" href="/dashboard">
              <div className="brand-mark">F</div>
              <div className="sidebar-text"><strong>FARMAXIA</strong><span>operación inteligente</span></div>
            </Link>
            <button aria-label={collapsed ? "Expandir menú" : "Contraer menú"} className="icon-button collapse-button" onClick={toggleCollapsed} title={collapsed ? "Expandir menú" : "Contraer menú"} type="button"><NavIcon name="collapse" /></button>
            <button aria-label="Cerrar menú" className="icon-button close-button" onClick={() => setMobileOpen(false)} type="button"><NavIcon name="close" /></button>
          </div>

          <div className="workspace-switcher" title={account ? `${account.tenantName} · ${account.branchName}` : undefined}>
            <span className="status-dot" />
            <div className="sidebar-text">
              <small>{account?.tenantName ?? "Farmacia"}</small>
              <strong>{account?.branchName ?? "Sucursal activa"}</strong>
            </div>
          </div>

          <nav className="main-nav" aria-label="Navegación principal">
            {visibleSections.map((section) => (
              <div className="nav-section" key={section.label}>
                <p className="nav-label">{section.label}</p>
                {section.items.map((item) => {
                  const active = item.href === current;
                  return (
                    <Link aria-current={active ? "page" : undefined} className={`nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.href} title={collapsed ? item.label : undefined}>
                      <span className="nav-icon"><NavIcon name={item.icon} /></span>
                      <span className="sidebar-text">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-footer">
            <ThemeToggle className="sidebar-theme-toggle" />
            <div className="user-card" title={account?.email}>
              <span className="user-avatar">{initials(displayName)}</span>
              <div className="sidebar-text"><strong>{displayName}</strong><small>{account?.email ?? ""}</small></div>
            </div>
            <button className="logout-button" onClick={signOut} title="Cerrar sesión" type="button"><span className="sidebar-text">Cerrar sesión</span> <NavIcon name="logout" /></button>
          </div>
        </aside>

        <div className="app-content">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}
