# Diseño técnico: Dockerización local completa

Se mantienen Dockerfiles separados por aplicación, construidos con el contexto
raíz para que pnpm pueda resolver el workspace y el lockfile. La imagen API
conserva las herramientas de migración locales y ejecuta
`db:migrate && start` al arrancar; la migración es segura para reintentos.

La imagen web usa `output: "standalone"` de Next.js y ejecuta el `server.js`
generado. Compose expone web en 3000 y API en 3001, añade healthchecks HTTP
basados en `node:22-alpine`, y usa `depends_on` con condición `service_healthy`.
Las URLs públicas del navegador siguen apuntando a `localhost`; los servicios
usan el nombre `postgres` para la conexión interna de la red Compose.
