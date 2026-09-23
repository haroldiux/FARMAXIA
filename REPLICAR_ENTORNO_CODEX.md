# Replicar el entorno de trabajo de Codex + Gentle AI en otra PC

Este documento describe cómo reproducir el entorno utilizado para FARMAXIA en
otra computadora Windows.

> **Importante:** la imagen adjunta es una captura de configuración de la
> interfaz de Codex, no una instrucción técnica independiente. Se interpreta
> como la configuración deseada: perfil "gentle-dev", modelo GPT-5.6 Luna con
> razonamiento alto y la opción visual **Acceso completo**.

## 1. Resultado que debe quedar instalado

### Versiones observadas en la PC actual

Estas son las versiones detectadas el 23 de septiembre de 2026:

| Componente | Versión observada |
| --- | --- |
| Codex CLI | "0.155.0" |
| Codex Desktop | "26.908.9136.0" |
| Gentle AI | "3.3.0" |
| Engram CLI | "2.0.0" |
| CodeGraph | "1.5.0" |
| GGA | "2.10.1" |
| Node.js | "22.20.0" |
| pnpm | "11.19.0" |
| Git | "2.51.0.windows.2" |
| Docker | "29.7.2" |

Codex informó que existen actualizaciones disponibles ("0.156.1" y Desktop
"26.917.8451.0"). Para replicar exactamente el estado histórico, usar las
versiones anteriores; para una instalación nueva se puede usar la última
versión estable, pero luego habrá que volver a validar MCP, skills y RDD.

## 2. Requisitos de Windows

Instalar y verificar:

1. Windows 10/11 de 64 bits.
2. Git para Windows.
3. Node.js 22.x.
4. pnpm 11.x.
5. Docker Desktop con motor Linux habilitado.
6. Codex Desktop y Codex CLI.
7. Gentle AI CLI.
8. Engram CLI.
9. CodeGraph CLI.

### Instalación base reproducible

Abrir PowerShell como usuario normal (no hace falta administrador para Codex)
y ejecutar lo siguiente:

~~~powershell
# Node.js 22.x debe estar instalado desde https://nodejs.org/ o mediante
# el instalador corporativo aprobado.
node --version

# Codex CLI oficial. La versión exacta observada fue 0.155.0; "latest"
# instala la versión estable disponible al momento de la réplica.
npm install --global @openai/codex@latest

# Gestor de paquetes del monorepo.
npm install --global pnpm@11.19.0

# Confirmar que no haya una segunda copia de codex.exe en PATH.
Get-Command codex -All
~~~

Gentle AI, Engram, CodeGraph y GGA deben instalarse desde el instalador o
release oficial de Gentle AI; no conviene adivinar paquetes npm porque el
binario y sus componentes administrados deben quedar en las rutas esperadas.
Una vez disponible el comando `gentle-ai`, la instalación administrada se
completa en la sección 5. Si el instalador ofrece elegir canal, seleccionar
`stable` para reproducir el canal usado aquí.

Para iniciar sesión en Codex sin copiar credenciales de la otra computadora:

~~~powershell
codex login
codex --version
~~~

La instalación oficial del CLI también se documenta en el [cookbook de
OpenAI sobre Goals en Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex).

Comandos de verificación:

~~~powershell
node --version
pnpm --version
git --version
docker --version
codex --version
gentle-ai version
engram --version
codegraph --version
gga --version
~~~

## 3. Instalar el proyecto

~~~powershell
New-Item -ItemType Directory -Force C:\PROYECTOS | Out-Null
Set-Location C:\PROYECTOS
git clone https://github.com/haroldiux/FARMAXIA.git
Set-Location C:\PROYECTOS\FARMAXIA
git fetch --all --prune
git switch --track origin/codex/f10-supplier-invoices
pnpm install
~~~

Si la rama local ya existe:

~~~powershell
git pull --ff-only
~~~

No copiar credenciales, tokens, "auth.json", claves SSH ni archivos ".env" de la
PC original. Deben autenticarse de nuevo en la PC destino.

## 4. CODEX_HOME y archivos persistentes

La PC actual utiliza:

~~~text
CODEX_HOME=C:\Users\harol\OneDrive\CodexSync\.codex
~~~

En otra PC se recomienda usar un directorio local:

~~~powershell
[Environment]::SetEnvironmentVariable("CODEX_HOME", "$HOME\.codex", "User")
$env:CODEX_HOME = "$HOME\.codex"
New-Item -ItemType Directory -Force $env:CODEX_HOME | Out-Null
~~~

No se recomienda copiar bases SQLite de sesiones, rollouts, colas o memoria
interna entre computadoras. Para transportar conocimiento del proyecto usar:

- "contexto.md".
- "AGENTS.md" y la carpeta "odd/" del repositorio.
- El historial Git.
- Engram, inicializado nuevamente en la PC destino.

## 5. Instalar Gentle AI para Codex

Instalar Gentle AI por su instalador/release estable y después ejecutar:

~~~powershell
gentle-ai install --agent codex --scope global --channel stable --sdd-mode multi
gentle-ai sync --agent codex --sdd-mode multi --strict-tdd --include-permissions --include-theme
~~~

La instalación actual usa el preset "full-gentleman". "gentle-dev" no es un
preset de Gentle AI: es el perfil de permisos mostrado por la interfaz de
Codex.

Verificar el ecosistema:

~~~powershell
gentle-ai doctor
gentle-ai version
~~~

El diagnóstico debe confirmar que existen "gentle-ai", "engram", "gga" y
"codex". Si aparece más de un "codex.exe" en "PATH", conservar una sola copia
para evitar que Desktop y CLI carguen versiones distintas.

## 6. Perfil "gentle-dev" y opciones de la imagen

La imagen muestra tres niveles de aprobación:

- **Solicitar aprobación:** preguntar antes de editar archivos externos o usar
  internet.
- **Aprobar por mí:** pedir aprobación solo para acciones potencialmente
  inseguras.
- **Acceso completo:** permitir internet y archivos sin restricciones.

También muestra el perfil "gentle-dev" y el modelo **GPT-5.6 Luna — Alto**.

### Configuración equivalente y segura

El perfil "gentle-dev" actual habilita escritura en el workspace, red y Git,
pero mantiene protecciones para secretos (".env", ".pem", ".key", credenciales,
".ssh"). El archivo "config.toml" debe tener una sección equivalente a:

~~~toml
approval_policy = "on-request"
model = "gpt-5.6-luna"
model_reasoning_effort = "high"

[permissions.gentle-dev]
description = "Comfortable local development profile with workspace writes, network access, Git metadata writes, Nix/Home Manager support, and secret-file protections."

[permissions.gentle-dev.network]
enabled = true

[permissions.gentle-dev.network.domains]
"*" = "allow"

[permissions.gentle-dev.filesystem]
":slash_tmp" = "write"
":tmpdir" = "write"
"~/.nix-profile" = "read"
"~/.local/state/nix/profiles/home-manager/home-path" = "read"
"~/.gitconfig" = "read"
":minimal" = "read"

[permissions.gentle-dev.workspace_roots]
"~" = true

[permissions.gentle-dev.filesystem.":workspace_roots"]
"**/secrets/**" = "deny"
"**/*.key" = "deny"
"**/*.pem" = "deny"
"**/credentials.json" = "deny"
"**/.ssh/**" = "deny"
"**/.credentials/**" = "deny"
"**/.env" = "deny"
"**/.env.local" = "deny"
"**/.env.*.local" = "deny"
~~~

### Reproducir exactamente “Acceso completo”

Solo para un workspace confiable y aislado:

~~~powershell
codex -C C:\PROYECTOS\FARMAXIA -m gpt-5.6-luna -s danger-full-access -a never
~~~

Esto elimina las confirmaciones y las restricciones del sandbox. Es más
arriesgado que "gentle-dev"; no debe usarse en repositorios desconocidos ni
cuando existen secretos accesibles en el equipo.

En la aplicación Desktop se puede seleccionar visualmente **Acceso completo**;
esa selección pertenece a la sesión y no debe confundirse con copiar tokens o
credenciales.

## 7. MCP activos de la PC actual

La salida real de "codex mcp list" muestra cuatro servidores stdio y uno HTTP:

| Nombre | Transporte | Configuración |
| --- | --- | --- |
| "codegraph" | stdio | "codegraph serve --mcp --no-watch" |
| "engram" | stdio | "engram mcp --tools=agent" |
| "node_repl" | stdio | Runtime CUA generado por Codex Desktop |
| "context7" | streamable HTTP | "https://mcp.context7.com/mcp" |
| "cua_repl" | stdio | Deshabilitado actualmente |

### Configurar MCP manualmente

~~~powershell
codex mcp add codegraph -- codegraph serve --mcp --no-watch
codex mcp add engram -- engram mcp --tools=agent
codex mcp add context7 --url https://mcp.context7.com/mcp
~~~

El servidor "node_repl" y su "cua_repl" asociado dependen de la instalación de
Codex Desktop. No copiar literalmente la ruta versionada de la PC actual; abrir
Desktop una vez y verificar:

~~~powershell
codex mcp list
~~~

Si "node_repl" no aparece, reparar/reinstalar Codex Desktop antes de crear una
entrada manual. Sus variables contienen pipes, rutas de runtime y datos del
host que cambian por versión y por computadora.

CodeGraph debe inicializarse por repositorio:

~~~powershell
Set-Location C:\PROYECTOS\FARMAXIA
codegraph init .
codegraph status .
codegraph install --target codex --location global --yes
~~~

La carpeta ".codegraph/" es local, se regenera en cada máquina y no debe
versionarse.

### Verificación MCP

~~~powershell
codex mcp list
codex mcp get codegraph
codex mcp get engram
codex mcp get context7
~~~

## 8. Plugins instalados y conectores

Plugins locales instalados/enabled en la PC actual:

- "documents@openai-primary-runtime"
- "pdf@openai-primary-runtime"
- "spreadsheets@openai-primary-runtime"
- "presentations@openai-primary-runtime"
- "template-creator@openai-primary-runtime"
- "engram@engram"
- "cowork-plugin-management@claude-cowork"
- "design@claude-cowork"
- "engineering@claude-cowork"
- "openai-templates@openai-curated-remote"
- "plugin-management@openai-curated-remote"

Verificar en la PC destino:

~~~powershell
codex plugin list
~~~

Los conectores GitHub, Google Drive, Figma y OpenAI Developers pueden aparecer
en el catálogo remoto pero requieren instalación/autenticación propia en la
PC destino. No copiar OAuth tokens ni archivos de credenciales. Después de
instalarlos, completar el login desde Codex:

~~~powershell
codex login
codex mcp login <servidor-si-corresponde>
~~~

La documentación oficial de OpenAI confirma que los MCP se pueden registrar
por CLI con "codex mcp add" y verificarse con "codex mcp list":
[Docs MCP](https://developers.openai.com/learn/docs-mcp).

## 9. Skills y reglas de trabajo

Gentle AI sincroniza las skills al instalar/sincronizar. La instalación actual
incluye, entre otras:

- "engram-memory".
- "sdd-*".
- "judgment-day".
- "work-unit-commits" y "chained-pr".
- "engineering:*".
- "design:*".
- "branch-pr", "issue-creation", "playwright", "pdf", "go-testing".

Confirmar la carpeta de skills:

~~~powershell
Get-ChildItem "$env:CODEX_HOME\skills" -Directory
~~~

El repositorio también contiene reglas de trabajo en "AGENTS.md", además de
"contexto.md", "odd/tasks/" y la documentación de arquitectura. Codex debe
abrir estas reglas antes de modificar código.

## 10. Engram

Engram se ejecuta como MCP stdio y persiste memoria del proyecto. En la PC
nueva:

~~~powershell
engram --version
codex mcp add engram -- engram mcp --tools=agent
~~~

Al iniciar una sesión del proyecto, detectar el proyecto con el directorio del
repositorio y buscar el contexto previo. No inventar IDs de sesión ni copiar
la base SQLite de otra PC.

## 11. Receipt-Driven Development (RDD)

RDD/Gentle AI está **apagado por defecto**. Verificar:

~~~powershell
gentle-ai review mode status
~~~

Activarlo solo después de revisar el candidato y decidirlo explícitamente:

~~~powershell
gentle-ai review mode enable --scope clone --cwd C:\PROYECTOS\FARMAXIA
~~~

Comprobar el estado nativo:

~~~powershell
gentle-ai review status --cwd C:\PROYECTOS\FARMAXIA --contract gentle-ai.review-integration/v2 --agent codex --next-transition
~~~

Reglas importantes:

1. RDD revisa candidatos concretos, no toda la rama indefinidamente.
2. La revisión empieza después de normalizar archivos y congelar el candidato.
3. No cambiar archivos después de iniciar una revisión sin seguir la transición
   nativa indicada por Gentle AI.
4. Una falta de consentimiento es una decisión para ese candidato, no una
   desactivación global.
5. PostgreSQL, Docker y las pruebas funcionales siguen siendo necesarios; RDD
   no los reemplaza.

## 12. Configuración de multi-agente

La PC actual tiene:

~~~toml
[features]
multi_agent = true

[agents]
max_depth = 2
max_threads = 4
~~~

La nueva PC debe conservar estos valores si se desea el mismo comportamiento de
delegación. Revisar que "spawn_agent", "wait_agent" y "list_agents" estén
disponibles en la sesión.

## 13. Base de datos y Docker para FARMAXIA

En el ".env" local de la PC destino configurar los valores del proyecto sin
subirlos a Git. Luego:

~~~powershell
Set-Location C:\PROYECTOS\FARMAXIA
docker compose up -d postgres redis
docker compose ps
pnpm --filter @farmaxia/api exec drizzle-kit check
pnpm --filter @farmaxia/api test
pnpm --filter @farmaxia/api build
pnpm --filter @farmaxia/web build
~~~

No copiar valores secretos desde la PC actual. Crear nuevas credenciales
locales y verificar que PostgreSQL use el puerto esperado ("5433" en el
entorno actual de FARMAXIA).

## 14. Diagnóstico final de la instalación

Ejecutar:

~~~powershell
gentle-ai doctor
codex doctor
codex mcp list
gentle-ai review mode status
git status --short
~~~

Condiciones mínimas para considerar la réplica lista:

- Codex, Gentle AI, Engram y CodeGraph responden.
- No hay dos binarios conflictivos de Codex en "PATH".
- MCP "codegraph", "engram", "node_repl" y "context7" aparecen correctamente.
- Plugins locales están instalados y los conectores requeridos fueron
  autenticados por separado.
- El repositorio FARMAXIA está en la rama remota deseada.
- PostgreSQL y Docker responden.
- "gentle-ai review mode status" muestra el estado elegido conscientemente.
- "contexto.md" y Engram permiten recuperar el trabajo sin copiar bases
  internas de sesiones.

## 15. Problemas detectados en la PC actual que no deben replicarse

"codex doctor" detectó:

- Dos copias de Codex en "PATH".
- Backend sandbox de Windows elevado no disponible.
- Exclusiones de Microsoft Defender no verificadas.
- "TERM=dumb" en ejecuciones no interactivas.
- Registros de threads/rollouts duplicados o faltantes.
- Una actualización de Codex y Desktop pendiente.

Estos avisos no impiden trabajar, pero conviene corregirlos en la PC nueva para
reducir cortes, problemas de sandbox y ejecuciones inconsistentes.

