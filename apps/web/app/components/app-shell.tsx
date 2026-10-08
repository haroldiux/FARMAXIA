"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { accountProfile, type AccountProfile } from "../lib/account";
import { listInventoryAlerts, type InventoryAlert } from "../lib/inventory";
import { moduleForPath, moduleSections, type AppModule } from "../lib/modules";
import { statusLabels, subscriptionSummary, type SubscriptionSummary } from "../lib/saas";
import { currentSession, logout, type AuthSession } from "../lib/session";
import { setTheme, useTheme } from "../lib/theme";
import { NavIcon } from "./nav-icon";

/** Rutas del sistema interno de la farmacia: todas llevan el marco con sidebar y barra superior. */
const tenantRoutes = ["/dashboard", "/catalog", "/inventory", "/procurement", "/transfers", "/controlled", "/staff", "/cash", "/sales", "/customers", "/analytics", "/audit", "/users", "/branches", "/integrations", "/billing", "/account"];

function isTenantRoute(pathname: string): boolean {
  return tenantRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

interface ShellValue {
  session: AuthSession;
  account: AccountProfile | null;
  subscription: SubscriptionSummary | null;
  /** Alertas de vencimiento sin revisar (null si el usuario no administra inventario). */
  alerts: InventoryAlert[] | null;
}

const ShellContext = createContext<ShellValue | null>(null);

/** Datos que ya cargó el marco (sesión, cuenta, suscripción y alertas); evita pedirlos otra vez. */
export function useShellSession(): ShellValue | null {
  return useContext(ShellContext);
}

/** Va en el layout raíz: envuelve con el marco solo las páginas internas (nunca el login). */
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
  const [session, setSession] = useState<AuthSession | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [alerts, setAlerts] = useState<InventoryAlert[] | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    currentSession()
      .then((value) => {
        if (!mounted) return;
        setSession(value);
        accountProfile().then((profile) => mounted && setAccount(profile)).catch(() => undefined);
        subscriptionSummary().then((summary) => mounted && setSubscription(summary)).catch(() => undefined);
      })
      .catch(() => {
        if (mounted) router.replace("/");
      });
    return () => {
      mounted = false;
    };
  }, [router]);

  // Las alertas se refrescan al cambiar de página (por ejemplo, después de marcar una como revisada).
  useEffect(() => {
    if (!session?.permissions.includes("inventory.manage")) return undefined;
    let mounted = true;
    listInventoryAlerts(false).then((result) => mounted && setAlerts(result.items)).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [session, pathname]);

  // En celular el menú se cierra al cambiar de página o con Escape.
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  async function signOut(): Promise<void> {
    await logout();
    router.replace("/");
  }

  if (!session) {
    return <main className="center-state"><span className="loading-orb" />Comprobando sesión…</main>;
  }

  const visibleSections = moduleSections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.permission || session.permissions.includes(item.permission)) }))
    .filter((section) => section.items.length > 0);
  const visibleModules = visibleSections.flatMap((section) => section.items);
  const currentModule = moduleForPath(pathname);
  const current = moduleForPath(pathname, visibleModules)?.href ?? null;

  return (
    <ShellContext.Provider value={{ session, account, subscription, alerts }}>
      <div className={`app-shell ax-shell ${mobileOpen ? "is-menu-open" : ""}`}>
        <button aria-hidden="true" className="ax-backdrop" onClick={() => setMobileOpen(false)} tabIndex={-1} type="button" />

        <aside aria-label="Menú principal" className="ax-sidebar">
          <div className="ax-brand-row">
            <Link className="ax-brand" href="/dashboard">
              <span className="ax-brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
              <strong>FARMAXIA</strong>
            </Link>
            <button aria-label="Cerrar menú" className="ax-icon-button ax-close" onClick={() => setMobileOpen(false)} type="button"><NavIcon name="close" /></button>
          </div>

          <nav className="ax-nav" aria-label="Navegación principal">
            {visibleSections.map((section) => (
              <div className="ax-nav-section" key={section.label}>
                {section.label !== "General" ? <p className="ax-nav-label">{section.label}</p> : null}
                {section.items.map((item) => {
                  const active = item.href === current;
                  return (
                    <Link aria-current={active ? "page" : undefined} className={`ax-link ${active ? "is-active" : ""}`} href={item.href} key={item.href}>
                      <NavIcon name={item.icon} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {subscription ? (
            <div className="ax-promo">
              <span className="ax-promo-shape" aria-hidden="true" />
              <strong>{subscription.plan.name}</strong>
              <p>{statusLabels[subscription.status]}{subscription.openInvoices ? ` · ${subscription.openInvoices} por pagar` : " · al día"}</p>
              {session.permissions.includes("billing.manage") ? <Link className="ax-promo-button" href="/billing">Ver suscripción</Link> : null}
            </div>
          ) : null}
        </aside>

        <div className="app-content" data-alt-tone={currentModule?.altTone ?? "lilac"} data-module={currentModule?.key ?? "dashboard"} data-tone={currentModule?.tone ?? "blue"}>
          <Topbar account={account} alerts={alerts} modules={visibleModules} onMenu={() => setMobileOpen(true)} onSignOut={signOut} />
          {/* key: al cambiar de página el contenido vuelve a entrar con una transición suave */}
          <div className="page-transition" key={pathname}>{children}</div>
        </div>
      </div>
    </ShellContext.Provider>
  );
}

/** Barra superior: usuario con su menú, buscador de módulos y campana de alertas. */
function Topbar({ account, alerts, modules, onMenu, onSignOut }: Readonly<{
  account: AccountProfile | null;
  alerts: InventoryAlert[] | null;
  modules: AppModule[];
  onMenu: () => void;
  onSignOut: () => void;
}>) {
  const router = useRouter();
  const theme = useTheme();
  const [menu, setMenu] = useState<"user" | "alerts" | null>(null);
  const [query, setQuery] = useState("");
  const barRef = useRef<HTMLElement>(null);

  // Cierra los menús al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!menu) return undefined;
    const onClick = (event: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(event.target as Node)) setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? modules.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(normalized)).slice(0, 6)
    : [];

  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const first = matches[0];
    if (first) {
      setQuery("");
      router.push(first.href);
    }
  }

  const displayName = account?.displayName ?? "Usuario";
  const pending = alerts?.length ?? 0;

  return (
    <header className="ax-topbar" ref={barRef}>
      <button aria-label="Abrir menú" className="ax-icon-button ax-menu-button" onClick={onMenu} type="button"><NavIcon name="menu" /></button>

      <div className="ax-user-wrap">
        <button aria-expanded={menu === "user"} aria-haspopup="menu" className="ax-user" onClick={() => setMenu(menu === "user" ? null : "user")} type="button">
          <span className="ax-avatar">{initials(displayName)}</span>
          <span className="ax-user-text"><strong>{displayName}</strong><small>{account?.email ?? ""}</small></span>
          <NavIcon name="chevron" />
        </button>
        {menu === "user" ? (
          <div className="ax-popover ax-user-menu" role="menu">
            <p className="ax-popover-title">{account ? `${account.tenantName} · ${account.branchName}` : "Tu cuenta"}</p>
            <Link className="ax-menu-item" href="/account" onClick={() => setMenu(null)} role="menuitem"><NavIcon name="account" />Mi cuenta</Link>
            <button className="ax-menu-item" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} role="menuitem" type="button">
              <NavIcon name={theme === "dark" ? "sun" : "moon"} />{theme === "dark" ? "Modo claro" : "Modo oscuro"}
            </button>
            <button className="ax-menu-item is-danger" onClick={onSignOut} role="menuitem" type="button"><NavIcon name="logout" />Cerrar sesión</button>
          </div>
        ) : null}
      </div>

      <div className="ax-topbar-right">
        {account ? <span className="ax-branch-pill"><span className="status-dot" />{account.branchName}</span> : null}
        <form className="ax-search" onSubmit={search} role="search">
          <NavIcon name="search" />
          <input aria-label="Buscar módulo" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar…" value={query} />
          {matches.length ? (
            <div className="ax-popover ax-search-results">
              {matches.map((item) => (
                <Link className="ax-menu-item" href={item.href} key={item.href} onClick={() => setQuery("")}><NavIcon name={item.icon} /><span>{item.label}<small>{item.description}</small></span></Link>
              ))}
            </div>
          ) : null}
        </form>
        <div className="ax-bell-wrap">
          <button aria-expanded={menu === "alerts"} aria-label={`Alertas${pending ? `: ${pending} sin revisar` : ""}`} className="ax-icon-button ax-bell" onClick={() => setMenu(menu === "alerts" ? null : "alerts")} type="button">
            <NavIcon name="bell" />
            {pending ? <span className="ax-badge">{pending > 9 ? "9+" : pending}</span> : null}
          </button>
          {menu === "alerts" ? (
            <div className="ax-popover ax-alerts-menu">
              <p className="ax-popover-title">Alertas de vencimiento</p>
              {alerts === null ? <p className="ax-popover-empty">Tu usuario no administra inventario.</p> : alerts.length ? alerts.slice(0, 5).map((alert) => (
                <Link className="ax-alert-row" href="/inventory" key={alert.id} onClick={() => setMenu(null)}>
                  <span className={`ax-chip ${alert.alertType === "EXPIRED" ? "is-critical" : "is-warning"}`}>{alert.alertType === "EXPIRED" ? "Vencido" : `${alert.daysToExpiry} días`}</span>
                  <span><strong>{alert.productName}</strong><small>Lote {alert.lotCode} · {alert.warehouseName}</small></span>
                </Link>
              )) : <p className="ax-popover-empty">Sin alertas pendientes.</p>}
              {alerts?.length ? <Link className="ax-popover-link" href="/inventory" onClick={() => setMenu(null)}>Ver inventario ↗</Link> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
