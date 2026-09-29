"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listProducts } from "../lib/catalog";
import { salesSummary, type SalesSummary } from "../lib/sales";
import { daysUntil, formatBob, formatDate, statusLabels } from "../lib/saas";
import { useShellSession } from "./app-shell";
import { NavIcon, type NavIconName } from "./nav-icon";

type Tint = "lilac" | "mint" | "peach" | "sand";

interface Metric {
  key: string;
  label: string;
  value: string;
  note: string;
  icon: NavIconName;
  href?: string;
  spark?: number[];
}

const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function money(value: string): string {
  return formatBob(value).replace(/\s?BOB$/, "");
}

/** "2026-09-29" → "29 sep" en hora local (sin corrimiento por zona horaria). */
function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("es-BO", { day: "numeric", month: "short" });
}

function relativeTime(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

/** Resumen de la farmacia al estilo Bento: métricas en pastel, gráficos, alertas y ventas recientes. */
export function DashboardShell() {
  const shell = useShellSession();
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [salesError, setSalesError] = useState(false);
  const [products, setProducts] = useState<number | null>(null);
  const session = shell?.session ?? null;
  const canSeeSales = Boolean(session && (session.permissions.includes("sales.confirm") || session.permissions.includes("cash.manage")));
  const canSeeCatalog = Boolean(session?.permissions.includes("catalog.manage"));

  useEffect(() => {
    if (!session) return undefined;
    let mounted = true;
    if (canSeeSales) salesSummary().then((value) => mounted && setSales(value)).catch(() => mounted && setSalesError(true));
    if (canSeeCatalog) listProducts({ limit: 1 }).then((value) => mounted && setProducts(value.total)).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [session, canSeeSales, canSeeCatalog]);

  if (!shell || !session) return null;
  const { account, subscription, alerts } = shell;
  const usersUsage = subscription?.usage.find((row) => row.resource === "users");
  const expired = alerts?.filter((alert) => alert.alertType === "EXPIRED").length ?? 0;

  // Fila superior: las cuatro métricas más importantes que este usuario puede ver.
  const topMetrics: Metric[] = [];
  if (canSeeSales) {
    topMetrics.push({ key: "today", label: "Ventas de hoy", value: sales ? money(sales.today.totalBob) : "…", note: sales ? `${sales.today.count} ${sales.today.count === 1 ? "venta" : "ventas"} hoy` : "Cargando", icon: "sales", href: "/sales", spark: sales?.daily.slice(-7).map((day) => Number(day.totalBob)) });
  }
  if (canSeeCatalog) {
    topMetrics.push({ key: "products", label: "Productos activos", value: products === null ? "…" : String(products), note: "en el catálogo", icon: "catalog", href: "/catalog" });
  }
  topMetrics.push({ key: "team", label: "Equipo", value: usersUsage ? String(usersUsage.used) : "…", note: usersUsage ? (usersUsage.limit ? `de ${usersUsage.limit} permitidos` : "usuarios activos") : "Cargando", icon: "users", href: session.permissions.includes("users.manage") ? "/users" : undefined });
  if (alerts !== null) {
    topMetrics.push({ key: "expiry", label: "Por vencer", value: String(alerts.length), note: expired ? `${expired} ya ${expired === 1 ? "vencido" : "vencidos"}` : "lotes en 30 días", icon: "alert", href: "/inventory" });
  }
  topMetrics.push({ key: "permissions", label: "Permisos", value: String(session.permissions.length), note: "activos en tu sesión", icon: "audit" });
  const tints: Tint[] = ["lilac", "mint", "peach", "sand"];

  // Segunda fila de métricas (colores intensos): datos del mes.
  const monthMetrics: Array<Metric & { tint: Tint }> = canSeeSales && sales ? [
    { key: "month", label: "Ventas del mes", value: money(sales.month.totalBob), note: `${sales.month.count} ${sales.month.count === 1 ? "venta" : "ventas"}`, icon: "trend", tint: "lilac" },
    { key: "ticket", label: "Ticket promedio", value: money(sales.month.averageTicketBob), note: "por venta este mes", icon: "cash", tint: "mint" },
    { key: "units", label: "Unidades vendidas", value: String(sales.month.units), note: "presentaciones este mes", icon: "inventory", tint: "peach" },
    { key: "branches", label: "Sucursales", value: account ? String(account.branches.length) : "…", note: "habilitadas para ti", icon: "overview", tint: "sand" }
  ] : [];

  return (
    <main className="dashboard-main ax-dashboard">
      <section className="ax-grid" aria-label="Métricas principales">
        {topMetrics.slice(0, 4).map((metric, index) => <MetricCard key={metric.key} metric={metric} tint={tints[index] ?? "lilac"} />)}
      </section>

      <section className="ax-grid ax-grid-main">
        <article className="ax-card ax-span-8">
          <div className="ax-card-head"><h2>Ventas por mes</h2><span className="ax-pill">Últimos 8 meses</span></div>
          {canSeeSales ? (sales ? <MonthlyBars data={sales.monthly} /> : <p className="ax-empty">{salesError ? "No pudimos cargar las ventas." : "Cargando ventas…"}</p>) : <p className="ax-empty">Tu usuario no tiene acceso a ventas.</p>}
        </article>
        <article className="ax-card ax-span-4">
          <div className="ax-card-head"><h2>Alertas del sistema</h2></div>
          <SystemAlerts />
        </article>
      </section>

      {monthMetrics.length ? (
        <section className="ax-grid" aria-label="Datos del mes">
          {monthMetrics.map((metric) => <MetricCard bright key={metric.key} metric={metric} tint={metric.tint} />)}
        </section>
      ) : null}

      <section className="ax-grid ax-grid-main">
        <article className="ax-card ax-span-8">
          <div className="ax-card-head"><h2>Ventas recientes</h2>{canSeeSales ? <Link className="ax-pill" href="/sales">Nueva venta ↗</Link> : null}</div>
          {canSeeSales && sales ? (
            sales.recent.length ? (
              <div className="ax-table" role="table">
                <div className="ax-table-head" role="row"><span>Venta</span><span>Cajero</span><span>Estado</span><span>Total</span><span>Fecha</span></div>
                {sales.recent.map((sale, index) => (
                  <div className={`ax-table-row ${index === 0 ? "is-highlight" : ""}`} key={sale.id} role="row">
                    <span className="ax-mono">V-{sale.id.slice(0, 6).toUpperCase()}</span>
                    <span>{sale.cashierName ?? "—"}</span>
                    <span><span className="ax-status is-ok" title="Confirmada">✓</span></span>
                    <span>{money(sale.totalBob)}</span>
                    <span className="ax-muted">{relativeTime(sale.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="ax-empty">Todavía no hay ventas en esta sucursal.</p>
          ) : <p className="ax-empty">{canSeeSales ? "Cargando…" : "Tu usuario no tiene acceso a ventas."}</p>}
        </article>
        <article className="ax-card ax-span-4">
          <div className="ax-card-head"><h2>Tendencia</h2><span className="ax-pill">14 días</span></div>
          <div className="ax-legend"><span><i className="is-indigo" />Ventas (Bs)</span><span><i className="is-green" />N.º de ventas</span></div>
          {canSeeSales && sales ? <TrendChart data={sales.daily} /> : <p className="ax-empty">{canSeeSales ? "Cargando…" : "Sin acceso a ventas."}</p>}
        </article>
      </section>
    </main>
  );

  function SystemAlerts() {
    const items: Array<{ key: string; level: "critical" | "warning" | "info"; title: string; note: string; href: string }> = [];
    for (const alert of (alerts ?? []).slice(0, 3)) {
      items.push({
        key: alert.id,
        level: alert.alertType === "EXPIRED" ? "critical" : "warning",
        title: `${alert.productName} · lote ${alert.lotCode}`,
        note: alert.alertType === "EXPIRED" ? "Vencido con stock" : `Vence en ${alert.daysToExpiry} días`,
        href: "/inventory"
      });
    }
    if (subscription) {
      const trialDays = daysUntil(subscription.trialEndsAt);
      if (subscription.status === "PAST_DUE" || subscription.status === "SUSPENDED") {
        items.push({ key: "sub", level: "critical", title: `Suscripción: ${statusLabels[subscription.status].toLowerCase()}`, note: subscription.graceEndsAt ? `Plazo: ${formatDate(subscription.graceEndsAt)}` : "Regulariza el pago", href: "/billing" });
      } else if (subscription.openInvoices) {
        items.push({ key: "sub", level: "warning", title: `${subscription.openInvoices} comprobante(s) por pagar`, note: `Plan ${subscription.plan.name}`, href: "/billing" });
      } else if (subscription.status === "TRIALING" && trialDays !== null) {
        items.push({ key: "sub", level: "info", title: "Periodo de prueba", note: `Quedan ${trialDays} días`, href: "/billing" });
      }
    }
    if (account && !account.twoFactorEnabled) {
      items.push({ key: "2fa", level: "info", title: "Verificación en dos pasos", note: "Actívala para proteger tu cuenta", href: "/account" });
    }
    if (!items.length) return <p className="ax-empty">Todo en orden. No hay alertas.</p>;
    const labels = { critical: "Crítico", warning: "Aviso", info: "Info" };
    return (
      <div className="ax-alert-list">
        {items.slice(0, 4).map((item) => (
          <Link className={`ax-system-alert is-${item.level}`} href={item.href} key={item.key}>
            <span className="ax-alert-icon"><NavIcon name="alert" /></span>
            <span className="ax-alert-text"><strong>{item.title}</strong><small>{item.note}</small></span>
            <span className={`ax-chip is-${item.level}`}>{labels[item.level]}</span>
          </Link>
        ))}
      </div>
    );
  }
}

function MetricCard({ metric, tint, bright = false }: Readonly<{ metric: Metric; tint: Tint; bright?: boolean }>) {
  const body = (
    <>
      <div className="ax-metric-head"><span>{metric.label}</span><span className="ax-metric-icon"><NavIcon name={metric.icon} /></span></div>
      <strong className="ax-metric-value">{metric.value}</strong>
      <small className="ax-metric-note">{metric.note}</small>
      {metric.spark && metric.spark.some((value) => value > 0) ? <Sparkline values={metric.spark} /> : null}
      {bright ? <span className="ax-metric-rings" aria-hidden="true" /> : null}
    </>
  );
  const className = `ax-metric ax-span-3 tint-${tint} ${bright ? "is-bright" : ""}`;
  return metric.href ? <Link className={className} href={metric.href}>{body}</Link> : <article className={className}>{body}</article>;
}

/** Mini barras con datos reales (ventas de los últimos 7 días). */
function Sparkline({ values }: Readonly<{ values: number[] }>) {
  const max = Math.max(...values, 1);
  return (
    <span className="ax-spark" aria-hidden="true">
      {values.map((value, index) => <i key={index} style={{ height: `${Math.max(12, (value / max) * 100)}%` }} />)}
    </span>
  );
}

function MonthlyBars({ data }: Readonly<{ data: SalesSummary["monthly"] }>) {
  const maxTotal = Math.max(...data.map((row) => Number(row.totalBob)), 1);
  const maxCount = Math.max(...data.map((row) => row.count), 1);
  const lastIndex = data.length - 1;
  return (
    <div className="ax-bars" role="img" aria-label={`Ventas por mes: ${data.map((row) => `${row.month} ${row.totalBob} BOB`).join(", ")}`}>
      <div className="ax-legend"><span><i className="is-indigo" />Ventas (Bs)</span><span><i className="is-yellow" />N.º de ventas</span></div>
      <div className="ax-bars-plot">
        {data.map((row, index) => {
          const monthIndex = Number(row.month.slice(5, 7)) - 1;
          const total = Number(row.totalBob);
          return (
            <div className={`ax-bar-group ${index === lastIndex ? "is-active" : ""}`} key={row.month} title={`${monthNames[monthIndex]}: ${money(row.totalBob)} · ${row.count} ventas`}>
              <div className="ax-bar-pair">
                <span className="ax-bar is-total" style={{ height: `${Math.max(8, (total / maxTotal) * 100)}%` }} />
                <span className="ax-bar is-count" style={{ height: `${Math.max(8, (row.count / maxCount) * 100)}%` }} />
              </div>
              <small>{monthNames[monthIndex]}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function smoothPath(points: Array<[number, number]>): string {
  if (!points.length) return "";
  let path = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    const mid = (x0 + x1) / 2;
    path += ` C ${mid} ${y0}, ${mid} ${y1}, ${x1} ${y1}`;
  }
  return path;
}

/** Área de ventas (Bs) y línea de cantidad de ventas de los últimos 14 días. */
function TrendChart({ data }: Readonly<{ data: SalesSummary["daily"] }>) {
  const width = 320;
  const height = 170;
  const pad = 10;
  const maxTotal = Math.max(...data.map((row) => Number(row.totalBob)), 1);
  const maxCount = Math.max(...data.map((row) => row.count), 1);
  const x = (index: number) => pad + (index * (width - pad * 2)) / Math.max(data.length - 1, 1);
  const totals: Array<[number, number]> = data.map((row, index) => [x(index), height - pad - (Number(row.totalBob) / maxTotal) * (height - pad * 3)]);
  const counts: Array<[number, number]> = data.map((row, index) => [x(index), height - pad - (row.count / maxCount) * (height - pad * 3) * 0.8]);
  const area = `${smoothPath(totals)} L ${x(data.length - 1)} ${height} L ${x(0)} ${height} Z`;
  const peak = totals.reduce((best, point, index) => (point[1] < totals[best]![1] ? index : best), 0);
  const first = data[0]?.day;
  const last = data.at(-1)?.day;
  return (
    <figure className="ax-trend">
      <svg aria-label={`Ventas diarias del ${first} al ${last}`} role="img" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <linearGradient id="ax-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--ax-indigo)" stopOpacity=".45" />
            <stop offset="100%" stopColor="var(--ax-indigo)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#ax-trend-fill)" />
        <path d={smoothPath(totals)} fill="none" stroke="var(--ax-indigo)" strokeLinecap="round" strokeWidth="3" />
        <path d={smoothPath(counts)} fill="none" stroke="var(--ax-green)" strokeDasharray="4 5" strokeLinecap="round" strokeWidth="2.5" />
        {totals.length ? <circle cx={totals[peak]![0]} cy={totals[peak]![1]} fill="var(--ax-card)" r="6" stroke="var(--ax-indigo)" strokeWidth="3" /> : null}
      </svg>
      <figcaption><span>{first ? dayLabel(first) : ""}</span><span>{last ? dayLabel(last) : ""}</span></figcaption>
    </figure>
  );
}
