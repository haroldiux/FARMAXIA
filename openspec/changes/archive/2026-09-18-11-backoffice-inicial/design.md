# Diseño técnico: Backoffice inicial autenticado

Se implementa una capa cliente mínima en Next.js: `LoginForm` controla el
formulario, llama a la API configurada por `NEXT_PUBLIC_API_URL`, conserva el
access token en `sessionStorage` y redirige a `/dashboard`. `DashboardShell`
valida la sesión al montar, intenta refresh con `credentials: include` y expone
logout. El token no se imprime ni se guarda en cookies JavaScript; el refresh
permanece HttpOnly en la API.

La API habilita CORS solo para `CORS_ORIGIN` (por defecto localhost:3000) con
credenciales. El dashboard usa exclusivamente la respuesta de `/auth/me` y
presenta tarjetas de estado sin datos falsos. El CSS global define una shell
responsive con navegación lateral en escritorio y barra superior compacta en
mobile, manteniendo controles con foco visible.
