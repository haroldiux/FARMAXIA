"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { currentSession, logout, type AuthSession } from "../lib/session";

const navigation = [
  { label: "Resumen", icon: "01", active: true },
  { label: "Catálogo", icon: "02", active: false },
  { label: "Inventario", icon: "03", active: false },
  { label: "Reporte global", icon: "07", active: false },
  { label: "Compras", icon: "04", active: false },
  { label: "Ventas y caja", icon: "05", active: false },
  { label: "Ventas POS", icon: "08", active: false },
  { label: "Auditoría", icon: "06", active: false }
];

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function DashboardShell() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);

  useEffect(() => {
    let mounted = true;
    currentSession()
      .then((value) => {
        if (mounted) {
          setSession(value);
        }
      })
      .catch(() => {
        if (mounted) {
          setSessionError(true);
          router.replace("/");
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [router]);

  async function signOut(): Promise<void> {
    await logout();
    router.replace("/");
  }

  if (loading && !sessionError) {
    return <main className="center-state"><span className="loading-orb" />Comprobando sesión…</main>;
  }
  if (!session) {
    return null;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">F</div>
          <div>
            <strong>FARMAXIA</strong>
            <span>operación inteligente</span>
          </div>
        </div>
        <div className="workspace-switcher">
          <span className="status-dot" />
          <div>
            <small>Espacio activo</small>
            <strong>{shortId(session.tenantId)}</strong>
          </div>
          <span className="switcher-arrow">⌄</span>
        </div>
        <nav className="main-nav" aria-label="Navegación principal">
          <p className="nav-label">Workspace</p>
          {navigation.map((item) => (
            item.label === "Catálogo" && session.permissions.includes("catalog.manage") ? <Link className="nav-item" href="/catalog" key={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link> : item.label === "Inventario" && session.permissions.includes("inventory.manage") ? <Link className="nav-item" href="/inventory" key={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link> : item.label === "Reporte global" && session.permissions.includes("inventory.report.global") ? <Link className="nav-item" href="/inventory/report" key={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link> : item.label === "Compras" && session.permissions.includes("inventory.manage") ? <Link className="nav-item" href="/procurement" key={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link> : item.label === "Ventas y caja" && session.permissions.includes("cash.manage") ? <Link className="nav-item" href="/cash" key={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link> : item.label === "Ventas POS" && session.permissions.includes("sales.confirm") ? <Link className="nav-item" href="/sales" key={item.label}>
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link> : <button className={`nav-item ${item.active ? "is-active" : ""}`} disabled={!item.active} key={item.label} type="button">
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              {!item.active ? <small>Próximo</small> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="secure-badge"><span>●</span> Sesión protegida</div>
          <button className="logout-button" onClick={signOut} type="button">Cerrar sesión <span>↗</span></button>
        </div>
      </aside>
      <main className="dashboard-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Panel de control</p>
            <h1>Una operación más clara.</h1>
          </div>
          <div className="context-pill">
            <span className="status-dot" />
            <div><small>Sucursal activa</small><strong>{shortId(session.branchId)}</strong></div>
          </div>
        </header>
        <section className="welcome-card">
          <div>
            <p className="section-kicker">Sesión validada</p>
            <h2>Tu espacio está listo para crecer.</h2>
            <p>La identidad y los permisos vienen directamente de la API. Los módulos se habilitarán a medida que cada flujo de negocio quede verificado.</p>
          </div>
          <div className="welcome-orbit" aria-hidden="true"><span /><span /><span /></div>
        </section>
        <section className="metrics-grid" aria-label="Estado de la plataforma">
          <article className="metric-card accent-blue"><span className="metric-index">01</span><p>Contexto</p><strong>Validado</strong><small>Tenant y sucursal activos</small></article>
          <article className="metric-card accent-orange"><span className="metric-index">02</span><p>Permisos efectivos</p><strong>{session.permissions.length}</strong><small>Devueltos por la sesión</small></article>
          <article className="metric-card accent-green"><span className="metric-index">03</span><p>Próximo foco</p><strong>Catálogo</strong><small>La siguiente vista funcional</small></article>
        </section>
        <section className="lower-grid">
          <article className="panel permissions-panel">
            <div className="panel-heading"><div><p className="section-kicker">Autorización</p><h3>Permisos de esta sesión</h3></div><span className="panel-count">{session.permissions.length.toString().padStart(2, "0")}</span></div>
            {session.permissions.length ? <div className="permission-list">{session.permissions.map((permission) => <span key={permission}>{permission}</span>)}</div> : <p className="empty-copy">No hay permisos efectivos para mostrar.</p>}
          </article>
          <article className="panel roadmap-panel">
            <div className="panel-heading"><div><p className="section-kicker">Construcción</p><h3>Lo que sigue</h3></div><span className="sparkle">✦</span></div>
            <div className="roadmap-row"><span className="roadmap-number">01</span><div><strong>Catálogo farmacéutico</strong><small>Productos, presentaciones y precios</small></div><span className="roadmap-state">Siguiente</span></div>
            <div className="roadmap-row muted"><span className="roadmap-number">02</span><div><strong>Inventario operativo</strong><small>FEFO, reservas y vencimientos</small></div><span className="roadmap-state">Después</span></div>
          </article>
        </section>
      </main>
    </div>
  );
}
