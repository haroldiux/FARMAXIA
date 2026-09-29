import Link from "next/link";
import { AuthBrand, AuthShowcase } from "./components/auth-showcase";
import { LoginForm } from "./components/login-form";
import { ThemeToggle } from "./components/theme-toggle";

export default function HomePage() {
  return (
    <main className="login-page lx-page">
      <ThemeToggle className="login-theme-toggle" />
      <section className="login-intro">
        <AuthBrand subtitle="operación inteligente" />
        <div className="intro-copy">
          <p className="eyebrow">Plataforma farmacéutica</p>
          <h1>Lo esencial,<br /><em>en orden.</em></h1>
          <p>Un espacio operativo para farmacias que necesitan claridad, trazabilidad y control en cada sucursal.</p>
        </div>
        <AuthShowcase variant="login" />
        <div className="intro-footer"><span>●</span> Multi-tenant · Multi-sucursal <span>2026</span></div>
      </section>
      <section className="login-panel">
        <div className="login-panel-heading"><p className="section-kicker">Acceso seguro</p><h2>Bienvenido de vuelta.</h2><p>Ingresa con el contexto de la sucursal donde vas a operar.</p></div>
        <LoginForm />
        <p className="login-footer auth-switch">¿Tu farmacia aún no tiene cuenta? <Link href="/register">Regístrala y prueba 7 días gratis</Link></p>
      </section>
    </main>
  );
}
