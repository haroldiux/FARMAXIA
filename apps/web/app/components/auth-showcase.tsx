import { NavIcon, type NavIconName } from "./nav-icon";

type Variant = "login" | "register" | "platform";

interface ShowcaseCard {
  tint: "lilac" | "mint" | "peach" | "sand";
  icon: NavIconName;
  title: string;
  note: string;
  /** Tipo de ilustración animada dentro de la tarjeta (no son datos reales). */
  visual: "bars" | "ring" | "chips" | "check";
}

// Tarjetas ilustrativas que imitan las métricas del sistema. No muestran datos.
const cards: Record<Variant, ShowcaseCard[]> = {
  login: [
    { tint: "lilac", icon: "sales", title: "Ventas", note: "Cobro con FEFO", visual: "bars" },
    { tint: "mint", icon: "inventory", title: "Stock", note: "Lotes al día", visual: "ring" },
    { tint: "peach", icon: "alert", title: "Vencimientos", note: "Alertas automáticas", visual: "chips" },
    { tint: "sand", icon: "cash", title: "Caja", note: "Turnos cuadrados", visual: "check" }
  ],
  register: [
    { tint: "lilac", icon: "overview", title: "7 días gratis", note: "Prueba sin tarjeta", visual: "check" },
    { tint: "mint", icon: "inventory", title: "Todo listo", note: "Sucursal, caja y almacén", visual: "ring" },
    { tint: "peach", icon: "catalog", title: "Catálogo", note: "Ficha sanitaria", visual: "chips" },
    { tint: "sand", icon: "report", title: "Reportes", note: "Por sucursal", visual: "bars" }
  ],
  platform: [
    { tint: "lilac", icon: "tenants", title: "Farmacias", note: "Altas y estados", visual: "bars" },
    { tint: "mint", icon: "billing", title: "Pagos", note: "Revisión de cobros", visual: "check" },
    { tint: "peach", icon: "plans", title: "Planes", note: "Límites y precios", visual: "ring" },
    { tint: "sand", icon: "audit", title: "Auditoría", note: "Todo queda registrado", visual: "chips" }
  ]
};

function Visual({ kind }: Readonly<{ kind: ShowcaseCard["visual"] }>) {
  if (kind === "bars") {
    return <span className="lx-visual-bars">{[48, 72, 40, 90, 64, 100].map((height, index) => <i key={index} style={{ height: `${height}%`, animationDelay: `${index * 120}ms` }} />)}</span>;
  }
  if (kind === "ring") {
    return (
      <svg className="lx-visual-ring" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="17" />
        <circle className="lx-ring-value" cx="22" cy="22" r="17" />
      </svg>
    );
  }
  if (kind === "chips") {
    return <span className="lx-visual-chips"><i /><i /><i /></span>;
  }
  return <span className="lx-visual-check">✓</span>;
}

/** Marca de FARMAXIA con los cuatro puntos de colores del sistema. */
export function AuthBrand({ subtitle }: Readonly<{ subtitle: string }>) {
  return (
    <div className="lx-brand">
      <span className="lx-brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
      <div><strong>FARMAXIA</strong><small>{subtitle}</small></div>
    </div>
  );
}

/** Tarjetas en pastel que flotan: una versión animada de las métricas del sistema. */
export function AuthShowcase({ variant }: Readonly<{ variant: Variant }>) {
  return (
    <div className="lx-showcase" aria-hidden="true">
      <span className="lx-glow lx-glow-a" />
      <span className="lx-glow lx-glow-b" />
      {cards[variant].map((card, index) => (
        <div className={`lx-card tint-${card.tint} lx-card-${index + 1}`} key={card.title}>
          <div className="lx-card-head">
            <span className="lx-card-icon"><NavIcon name={card.icon} /></span>
            <Visual kind={card.visual} />
          </div>
          <strong>{card.title}</strong>
          <small>{card.note}</small>
        </div>
      ))}
    </div>
  );
}
