-- Módulo 1: usuarios, roles, 2FA y sesiones.
-- Rol nuevo `farmaxia_identity`: administra usuarios y roles de UNA farmacia (app.tenant_id).
-- farmaxia_app sigue sin poder escribir usuarios, roles ni membresías.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'farmaxia_identity') THEN
    CREATE ROLE farmaxia_identity LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD 'local-development-only';
  ELSE
    ALTER ROLE farmaxia_identity NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint
-- La farmacia "dueña" de la cuenta: solo ella puede cambiar su contraseña, nombre o 2FA.
-- Evita que el admin de una farmacia tome la cuenta de alguien que también trabaja en otra.
ALTER TABLE "users" ADD COLUMN "home_tenant_id" uuid;
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "totp_secret" varchar(255);
ALTER TABLE "users" ADD COLUMN "totp_pending_secret" varchar(255);
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;
ALTER TABLE "users" ADD COLUMN "password_changed_at" timestamp with time zone;
ALTER TABLE "users" ADD CONSTRAINT "users_home_tenant_fk" FOREIGN KEY ("home_tenant_id") REFERENCES "public"."tenants"("id");
UPDATE users SET home_tenant_id = (
  SELECT membership.tenant_id FROM user_branch_memberships AS membership
  WHERE membership.user_id = users.id
  ORDER BY membership.created_at
  LIMIT 1
) WHERE home_tenant_id IS NULL;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "name" varchar(120) DEFAULT '' NOT NULL;
ALTER TABLE "roles" ADD COLUMN "description" varchar(255) DEFAULT '' NOT NULL;
ALTER TABLE "roles" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;
ALTER TABLE "roles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
UPDATE roles SET name = initcap(replace(code, '-', ' ')) WHERE name = '';
--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN "label" varchar(160) DEFAULT '' NOT NULL;
ALTER TABLE "permissions" ADD COLUMN "module" varchar(80) DEFAULT 'General' NOT NULL;
ALTER TABLE "permissions" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Sesiones: dispositivo, IP y fecha de inicio de la cadena de refresh para listarlas y cerrarlas.
ALTER TABLE "auth_sessions" ADD COLUMN "user_agent" varchar(255);
ALTER TABLE "auth_sessions" ADD COLUMN "ip_address" varchar(64);
ALTER TABLE "auth_sessions" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE INDEX "auth_sessions_user_active_idx" ON "auth_sessions" USING btree ("user_id", "expires_at") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
INSERT INTO permissions (code, description, label, module, sort_order) VALUES
  ('catalog.manage', 'Manage catalog and prices', 'Administrar catálogo y precios', 'Catálogo', 10),
  ('inventory.manage', 'Manage inventory operations', 'Administrar inventario y compras', 'Inventario', 20),
  ('inventory.report.global', 'Read tenant-wide inventory reports', 'Ver reporte global de inventario', 'Inventario', 30),
  ('cash.manage', 'Manage cash registers and shifts', 'Operar caja y turnos', 'Caja y ventas', 40),
  ('cash.shift.approve', 'Approve non-zero cash shift differences', 'Aprobar diferencias de caja', 'Caja y ventas', 50),
  ('sales.confirm', 'Confirm non-fiscal cash sales', 'Registrar ventas', 'Caja y ventas', 60),
  ('audit.read', 'Read the tenant audit log within the plan retention', 'Ver bitácora de auditoría', 'Administración', 70),
  ('billing.manage', 'View the subscription, invoices and submit payments', 'Ver suscripción y pagar', 'Administración', 80),
  ('users.manage', 'Manage users, roles and branch access', 'Administrar usuarios y roles', 'Administración', 90)
ON CONFLICT (code) DO UPDATE SET label = excluded.label, module = excluded.module, sort_order = excluded.sort_order;
--> statement-breakpoint
-- Roles predefinidos para cada farmacia existente (las nuevas los reciben al registrarse).
INSERT INTO roles (tenant_id, code, name, description, is_system)
SELECT tenant.id, template.code, template.name, template.description, true
FROM tenants AS tenant
CROSS JOIN (VALUES
  ('owner', 'Propietario', 'Acceso total, incluida la suscripción y los usuarios.'),
  ('regente', 'Regente farmacéutico', 'Catálogo, inventario, ventas y auditoría.'),
  ('encargado', 'Encargado de sucursal', 'Operación completa de la sucursal, sin usuarios ni suscripción.'),
  ('cajero', 'Cajero', 'Caja y ventas.'),
  ('almacenero', 'Almacenero', 'Inventario, compras y recepción.')
) AS template(code, name, description)
ON CONFLICT (tenant_id, code) DO UPDATE SET name = excluded.name, description = excluded.description, is_system = true;
--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_code)
SELECT roles.id, grant_row.permission_code
FROM roles
JOIN (VALUES
  ('owner', 'catalog.manage'), ('owner', 'inventory.manage'), ('owner', 'inventory.report.global'),
  ('owner', 'cash.manage'), ('owner', 'cash.shift.approve'), ('owner', 'sales.confirm'),
  ('owner', 'audit.read'), ('owner', 'billing.manage'), ('owner', 'users.manage'),
  ('regente', 'catalog.manage'), ('regente', 'inventory.manage'), ('regente', 'inventory.report.global'),
  ('regente', 'sales.confirm'), ('regente', 'audit.read'),
  ('encargado', 'catalog.manage'), ('encargado', 'inventory.manage'), ('encargado', 'inventory.report.global'),
  ('encargado', 'cash.manage'), ('encargado', 'cash.shift.approve'), ('encargado', 'sales.confirm'), ('encargado', 'audit.read'),
  ('cajero', 'cash.manage'), ('cajero', 'sales.confirm'),
  ('almacenero', 'inventory.manage')
) AS grant_row(role_code, permission_code) ON grant_row.role_code = roles.code AND roles.is_system
ON CONFLICT (role_id, permission_code) DO NOTHING;
--> statement-breakpoint
-- farmaxia_auth: resolver farmacia y sucursal tras validar la contraseña, 2FA propio,
-- cambio de contraseña propio y gestión de sesiones propias.
GRANT SELECT (id, slug, name) ON TABLE tenants TO farmaxia_auth;
GRANT SELECT (id, tenant_id, code, name, is_active) ON TABLE branches TO farmaxia_auth;
GRANT UPDATE (password_hash, password_changed_at, last_login_at, totp_secret, totp_pending_secret, totp_enabled_at, totp_last_step) ON TABLE users TO farmaxia_auth;
CREATE POLICY user_branch_memberships_auth_resolve ON user_branch_memberships
  FOR SELECT TO farmaxia_auth
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  );
CREATE POLICY tenants_auth_membership_read ON tenants
  FOR SELECT TO farmaxia_auth
  USING (
    EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.tenant_id = tenants.id
        AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
CREATE POLICY branches_auth_membership_read ON branches
  FOR SELECT TO farmaxia_auth
  USING (
    EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.tenant_id = branches.tenant_id
        AND membership.branch_id = branches.id
        AND membership.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
CREATE POLICY users_auth_self_read ON users
  FOR SELECT TO farmaxia_auth
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY users_auth_self_update ON users
  FOR UPDATE TO farmaxia_auth
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY auth_sessions_auth_self_read ON auth_sessions
  FOR SELECT TO farmaxia_auth
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY auth_sessions_auth_self_revoke ON auth_sessions
  FOR UPDATE TO farmaxia_auth
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- farmaxia_identity: todo acotado a app.tenant_id.
GRANT USAGE ON SCHEMA public TO farmaxia_identity;
GRANT SELECT (id, slug, name) ON TABLE tenants TO farmaxia_identity;
GRANT SELECT ON TABLE branches, permissions, tenant_subscriptions, subscription_plans, plan_quotas, subscription_quota_overrides TO farmaxia_identity;
GRANT SELECT, INSERT, UPDATE ON TABLE tenant_resource_usage TO farmaxia_identity;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE roles, role_permissions, user_roles, user_branch_memberships TO farmaxia_identity;
GRANT SELECT (id, email, display_name, is_active, created_at, home_tenant_id, last_login_at, totp_enabled_at) ON TABLE users TO farmaxia_identity;
GRANT INSERT (email, display_name, password_hash, is_active, home_tenant_id, password_changed_at) ON TABLE users TO farmaxia_identity;
GRANT UPDATE (display_name, is_active, password_hash, password_changed_at, totp_secret, totp_pending_secret, totp_enabled_at, totp_last_step) ON TABLE users TO farmaxia_identity;
GRANT SELECT (id, user_id, tenant_id, branch_id, revoked_at, expires_at), UPDATE (revoked_at) ON TABLE auth_sessions TO farmaxia_identity;
GRANT SELECT, INSERT ON TABLE audit_events TO farmaxia_identity;
--> statement-breakpoint
CREATE POLICY tenants_identity_read ON tenants FOR SELECT TO farmaxia_identity
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY branches_identity_read ON branches FOR SELECT TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY subscription_plans_identity_read ON subscription_plans FOR SELECT TO farmaxia_identity USING (true);
CREATE POLICY plan_quotas_identity_read ON plan_quotas FOR SELECT TO farmaxia_identity USING (true);
CREATE POLICY tenant_subscriptions_identity_read ON tenant_subscriptions FOR SELECT TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY subscription_quota_overrides_identity_read ON subscription_quota_overrides FOR SELECT TO farmaxia_identity
  USING (EXISTS (
    SELECT 1 FROM tenant_subscriptions
    WHERE tenant_subscriptions.id = subscription_quota_overrides.subscription_id
      AND tenant_subscriptions.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ));
CREATE POLICY tenant_resource_usage_identity_all ON tenant_resource_usage FOR ALL TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY roles_identity_all ON roles FOR ALL TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY user_roles_identity_all ON user_roles FOR ALL TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY user_branch_memberships_identity_all ON user_branch_memberships FOR ALL TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
-- Los demás roles ya leían role_permissions sin RLS; se conservan esas lecturas.
CREATE POLICY role_permissions_read_all ON role_permissions FOR SELECT TO farmaxia_app, farmaxia_auth, farmaxia_platform USING (true);
CREATE POLICY role_permissions_platform_write ON role_permissions FOR INSERT TO farmaxia_platform WITH CHECK (true);
CREATE POLICY role_permissions_identity_all ON role_permissions FOR ALL TO farmaxia_identity
  USING (EXISTS (
    SELECT 1 FROM roles WHERE roles.id = role_permissions.role_id
      AND roles.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM roles WHERE roles.id = role_permissions.role_id
      AND roles.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ));
-- Usuarios: se ven los que tienen acceso a esta farmacia; solo se crean y modifican los
-- que pertenecen a ella (home_tenant_id).
CREATE POLICY users_identity_read ON users FOR SELECT TO farmaxia_identity
  USING (
    home_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM user_branch_memberships AS membership
      WHERE membership.user_id = users.id
        AND membership.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    )
  );
CREATE POLICY users_identity_insert ON users FOR INSERT TO farmaxia_identity
  WITH CHECK (home_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY users_identity_update ON users FOR UPDATE TO farmaxia_identity
  USING (home_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (home_tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY auth_sessions_identity_revoke ON auth_sessions FOR ALL TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY audit_events_identity_insert ON audit_events FOR ALL TO farmaxia_identity
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
-- El alta de farmacias fija la farmacia dueña de la cuenta del propietario.
GRANT UPDATE (home_tenant_id) ON TABLE users TO farmaxia_platform;
GRANT SELECT, INSERT ON TABLE role_permissions TO farmaxia_platform;
--> statement-breakpoint
-- Farmacias creadas antes de este módulo: quien tenía el rol "admin" pasa a ser Propietario,
-- para que siempre exista al menos uno.
INSERT INTO user_roles (user_id, tenant_id, role_id)
SELECT user_roles.user_id, user_roles.tenant_id, owner_role.id
FROM user_roles
JOIN roles AS legacy ON legacy.id = user_roles.role_id AND legacy.code = 'admin'
JOIN roles AS owner_role ON owner_role.tenant_id = user_roles.tenant_id AND owner_role.code = 'owner' AND owner_role.is_system
ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING;
