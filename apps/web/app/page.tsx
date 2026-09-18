import { LoginForm } from "./components/login-form";

export default function HomePage() {
  return (
    <main className="login-page">
      <section className="login-intro">
        <div className="brand-lockup brand-lockup-dark">
          <div className="brand-mark">F</div>
          <div><strong>FARMAXIA</strong><span>operación inteligente</span></div>
        </div>
        <div className="intro-copy">
          <p className="eyebrow">Plataforma farmacéutica</p>
          <h1>Lo esencial,<br /><em>en orden.</em></h1>
          <p>Un espacio operativo para farmacias que necesitan claridad, trazabilidad y control en cada sucursal.</p>
        </div>
        <div className="intro-footer"><span>●</span> Multi-tenant · Multi-sucursal <span>2026</span></div>
      </section>
      <section className="login-panel">
        <div className="login-panel-heading"><p className="section-kicker">Acceso seguro</p><h2>Bienvenido de vuelta.</h2><p>Ingresa con el contexto de la sucursal donde vas a operar.</p></div>
        <LoginForm />
        <p className="login-footer">FARMAXIA protege cada operación con permisos y contexto verificado.</p>
      </section>
    </main>
  );
}
