-- Custom SQL migration file, put your code below! --
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_auth_login_read ON users
  FOR SELECT TO farmaxia_auth
  USING (email = NULLIF(current_setting('app.login_email', true), ''));
--> statement-breakpoint
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_sessions_auth_lookup ON auth_sessions
  FOR SELECT TO farmaxia_auth
  USING (token_hash = NULLIF(current_setting('app.refresh_token_hash', true), ''));
CREATE POLICY auth_sessions_auth_create ON auth_sessions
  FOR INSERT TO farmaxia_auth
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
CREATE POLICY auth_sessions_auth_revoke ON auth_sessions
  FOR UPDATE TO farmaxia_auth
  USING (token_hash = NULLIF(current_setting('app.refresh_token_hash', true), ''))
  WITH CHECK (token_hash = NULLIF(current_setting('app.refresh_token_hash', true), ''));
