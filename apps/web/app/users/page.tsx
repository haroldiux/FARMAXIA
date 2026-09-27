"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { formatDate } from "../lib/saas";
import { currentSession, type AuthSession } from "../lib/session";
import {
  createRole,
  createUser,
  deleteRole,
  listBranches,
  listPermissions,
  listRoles,
  listUsers,
  resetUserPassword,
  resetUserTwoFactor,
  updateRole,
  updateUser,
  type PermissionDefinition,
  type TenantBranch,
  type TenantRole,
  type TenantUser
} from "../lib/users";

type Tab = "users" | "roles";
type UserPanel = { kind: "none" } | { kind: "create" } | { kind: "edit"; user: TenantUser } | { kind: "password"; user: TenantUser };
type RolePanel = { kind: "none" } | { kind: "create" } | { kind: "edit"; role: TenantRole } | { kind: "view"; role: TenantRole };

const emptyUserForm = { displayName: "", email: "", password: "", roleIds: [] as string[], branchIds: [] as string[] };
const emptyRoleForm = { name: "", description: "", permissionCodes: [] as string[] };

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function UsersPage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [roles, setRoles] = useState<TenantRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionDefinition[]>([]);
  const [branches, setBranches] = useState<TenantBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userPanel, setUserPanel] = useState<UserPanel>({ kind: "none" });
  const [rolePanel, setRolePanel] = useState<RolePanel>({ kind: "none" });
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [roleForm, setRoleForm] = useState(emptyRoleForm);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    const [nextUsers, nextRoles, nextPermissions, nextBranches] = await Promise.all([listUsers(), listRoles(), listPermissions(), listBranches()]);
    setUsers(nextUsers);
    setRoles(nextRoles);
    setPermissions(nextPermissions);
    setBranches(nextBranches.filter((branch) => branch.isActive));
  }, []);

  useEffect(() => {
    currentSession()
      .then(async (value) => {
        setSession(value);
        if (value.permissions.includes("users.manage")) await load();
      })
      .catch(() => window.location.assign("/"))
      .finally(() => setLoading(false));
  }, [load]);

  const permissionLabels = useMemo(() => new Map(permissions.map((permission) => [permission.code, permission.label])), [permissions]);
  const permissionGroups = useMemo(() => {
    const groups = new Map<string, PermissionDefinition[]>();
    for (const permission of permissions) groups.set(permission.module, [...(groups.get(permission.module) ?? []), permission]);
    return [...groups.entries()];
  }, [permissions]);
  const mine = new Set(session?.permissions ?? []);

  async function run(action: () => Promise<string>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No pudimos completar la acción.");
    } finally {
      setBusy(false);
    }
  }

  function openUser(panel: UserPanel): void {
    setUserPanel(panel);
    setError(null);
    setNotice(null);
    setNewPassword("");
    setUserForm(panel.kind === "edit"
      ? { displayName: panel.user.displayName, email: panel.user.email, password: "", roleIds: panel.user.roles.map((role) => role.id), branchIds: panel.user.branches.map((branch) => branch.id) }
      : { ...emptyUserForm, branchIds: branches.length === 1 && branches[0] ? [branches[0].id] : [] });
  }

  function openRole(panel: RolePanel): void {
    setRolePanel(panel);
    setError(null);
    setNotice(null);
    setRoleForm(panel.kind === "edit" || panel.kind === "view"
      ? { name: panel.role.name, description: panel.role.description, permissionCodes: panel.role.permissions }
      : emptyRoleForm);
  }

  function submitUser(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (userPanel.kind === "create") {
      void run(async () => {
        await createUser(userForm);
        setUserPanel({ kind: "none" });
        return `Usuario ${userForm.displayName} creado. Ya puede iniciar sesión con su correo.`;
      });
    } else if (userPanel.kind === "edit") {
      const { user } = userPanel;
      void run(async () => {
        await updateUser(user.id, {
          displayName: user.managedHere ? userForm.displayName : undefined,
          roleIds: user.id === session?.userId ? undefined : userForm.roleIds,
          branchIds: userForm.branchIds
        });
        setUserPanel({ kind: "none" });
        return "Cambios guardados.";
      });
    }
  }

  function submitPassword(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (userPanel.kind !== "password") return;
    const { user } = userPanel;
    void run(async () => {
      await resetUserPassword(user.id, newPassword);
      setUserPanel({ kind: "none" });
      return `Contraseña de ${user.displayName} restablecida. Sus sesiones abiertas se cerraron.`;
    });
  }

  function submitRole(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const payload = { name: roleForm.name, description: roleForm.description, permissionCodes: roleForm.permissionCodes };
    void run(async () => {
      if (rolePanel.kind === "edit") {
        await updateRole(rolePanel.role.id, payload);
      } else {
        await createRole(payload);
      }
      setRolePanel({ kind: "none" });
      return rolePanel.kind === "edit" ? "Rol actualizado." : `Rol ${roleForm.name} creado.`;
    });
  }

  if (loading) {
    return <main className="center-state"><span className="loading-orb" />Cargando usuarios…</main>;
  }
  if (!session) return null;
  if (!session.permissions.includes("users.manage")) {
    return <main className="center-state inventory-denied"><div><strong>Acceso restringido</strong><p>Tu usuario no puede administrar usuarios ni roles.</p><Link href="/dashboard">Volver al resumen</Link></div></main>;
  }

  const editingSelf = userPanel.kind === "edit" && userPanel.user.id === session.userId;
  const editingForeign = userPanel.kind === "edit" && !userPanel.user.managedHere;

  return (
    <main className="cash-page">
      <header className="cash-header">
        <div>
          <Link className="back-link" href="/dashboard">← Volver al resumen</Link>
          <p className="eyebrow">Equipo</p>
          <h1>Usuarios y roles.</h1>
          <p className="cash-lede">Da acceso a tu equipo con el rol que corresponde y elige en qué sucursales puede trabajar cada persona.</p>
        </div>
      </header>

      <div className="segmented" role="tablist" aria-label="Secciones">
        <button aria-selected={tab === "users"} className={tab === "users" ? "is-active" : ""} onClick={() => setTab("users")} role="tab" type="button">Usuarios · {users.length}</button>
        <button aria-selected={tab === "roles"} className={tab === "roles" ? "is-active" : ""} onClick={() => setTab("roles")} role="tab" type="button">Roles · {roles.length}</button>
      </div>
      {error ? <p className="form-error cash-message" role="alert">{error}</p> : null}
      {notice ? <p className="form-success cash-message" role="status">{notice}</p> : null}

      {tab === "users" ? (
        <section className="cash-layout">
          <article className="panel">
            <div className="panel-heading"><div><p className="section-kicker">Equipo</p><h2>Usuarios</h2></div><button className="secondary-button" onClick={() => openUser({ kind: "create" })} type="button">+ Nuevo usuario</button></div>
            <div className="user-list">
              {users.map((user) => (
                <article className={`user-row ${user.isActive ? "" : "is-inactive"}`} key={user.id}>
                  <span className="product-avatar" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span>
                  <div className="user-main">
                    <strong>{user.displayName}{user.id === session.userId ? <em>Tú</em> : null}</strong>
                    <small>{user.email}</small>
                    <div className="chip-row">
                      {user.roles.map((role) => <span className="chip chip-role" key={role.id}>{role.name}</span>)}
                      {user.branches.map((branch) => <span className="chip" key={branch.id}>{branch.name}</span>)}
                    </div>
                    <small>{user.isActive ? (user.lastLoginAt ? `Último ingreso ${formatDate(user.lastLoginAt, true)}` : "Aún no ingresó") : "Desactivado"}{user.twoFactorEnabled ? " · 2FA activa" : ""}{!user.managedHere ? " · cuenta de otra farmacia" : ""}</small>
                  </div>
                  <div className="user-actions">
                    <button className="row-action" onClick={() => openUser({ kind: "edit", user })} type="button">Editar</button>
                    {user.managedHere && user.id !== session.userId ? (
                      <>
                        <button className="row-action" onClick={() => openUser({ kind: "password", user })} type="button">Contraseña</button>
                        {user.twoFactorEnabled ? <button className="row-action" disabled={busy} onClick={() => {
                          if (window.confirm(`¿Quitar la verificación en dos pasos de ${user.displayName}? Podrá volver a configurarla.`)) {
                            void run(async () => { await resetUserTwoFactor(user.id); return "Verificación en dos pasos quitada."; });
                          }
                        }} type="button">Quitar 2FA</button> : null}
                        <button className={`row-action ${user.isActive ? "row-action-danger" : ""}`} disabled={busy} onClick={() => {
                          if (!user.isActive || window.confirm(`¿Desactivar a ${user.displayName}? No podrá entrar y se cerrarán sus sesiones.`)) {
                            void run(async () => {
                              await updateUser(user.id, { isActive: !user.isActive });
                              return user.isActive ? `${user.displayName} fue desactivado.` : `${user.displayName} fue reactivado.`;
                            });
                          }
                        }} type="button">{user.isActive ? "Desactivar" : "Reactivar"}</button>
                      </>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </article>

          <aside className="panel cash-form-panel">
            {userPanel.kind === "none" ? (
              <div className="inventory-action-placeholder billing-placeholder">
                <span className="empty-symbol">✦</span>
                <h2>Elige un usuario</h2>
                <p>O crea uno nuevo. Cada usuario ocupa un lugar del límite de tu plan.</p>
              </div>
            ) : userPanel.kind === "password" ? (
              <form className="cash-form" onSubmit={submitPassword}>
                <div className="panel-heading"><div><p className="section-kicker">Acceso</p><h2>Nueva contraseña</h2></div><button aria-label="Cerrar" className="close-action" onClick={() => setUserPanel({ kind: "none" })} type="button">×</button></div>
                <p className="action-context">Para <strong>{userPanel.user.displayName}</strong>. Compártela en persona; podrá cambiarla desde Mi cuenta.</p>
                <label className="field"><span>Contraseña temporal</span><input autoComplete="new-password" minLength={10} required type="text" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                <p className="form-note">Mínimo 10 caracteres, con letras y números.</p>
                <button className="primary-button" disabled={busy} type="submit">{busy ? "Guardando…" : "Restablecer contraseña"}<span aria-hidden="true">↗</span></button>
              </form>
            ) : (
              <form className="cash-form" onSubmit={submitUser}>
                <div className="panel-heading"><div><p className="section-kicker">{userPanel.kind === "create" ? "Alta" : "Edición"}</p><h2>{userPanel.kind === "create" ? "Nuevo usuario" : userPanel.user.displayName}</h2></div><button aria-label="Cerrar" className="close-action" onClick={() => setUserPanel({ kind: "none" })} type="button">×</button></div>
                {editingForeign ? <p className="action-context">Esta cuenta pertenece a otra farmacia: aquí solo cambias sus roles y sucursales.</p> : null}
                <label className="field"><span>Nombre completo</span><input disabled={editingForeign} maxLength={160} minLength={2} required value={userForm.displayName} onChange={(event) => setUserForm({ ...userForm, displayName: event.target.value })} /></label>
                {userPanel.kind === "create" ? (
                  <>
                    <label className="field"><span>Correo</span><input autoComplete="off" required type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} placeholder="persona@farmacia.com" /></label>
                    <label className="field"><span>Contraseña temporal</span><input autoComplete="new-password" minLength={10} required type="text" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></label>
                  </>
                ) : null}
                <fieldset className="check-fieldset">
                  <legend>Roles</legend>
                  {editingSelf ? <p className="form-note">No puedes cambiar tus propios roles.</p> : null}
                  {roles.map((role) => {
                    const allowed = role.permissions.every((code) => mine.has(code));
                    return (
                      <label className={`check-option ${allowed ? "" : "is-locked"}`} key={role.id}>
                        <input checked={userForm.roleIds.includes(role.id)} disabled={editingSelf || !allowed} onChange={() => setUserForm({ ...userForm, roleIds: toggle(userForm.roleIds, role.id) })} type="checkbox" />
                        <span><strong>{role.name}</strong><small>{allowed ? role.description || `${role.permissions.length} permisos` : "Incluye permisos que tú no tienes"}</small></span>
                      </label>
                    );
                  })}
                </fieldset>
                <fieldset className="check-fieldset">
                  <legend>Sucursales</legend>
                  {branches.map((branch) => (
                    <label className="check-option" key={branch.id}>
                      <input checked={userForm.branchIds.includes(branch.id)} onChange={() => setUserForm({ ...userForm, branchIds: toggle(userForm.branchIds, branch.id) })} type="checkbox" />
                      <span><strong>{branch.name}</strong><small>{branch.code}</small></span>
                    </label>
                  ))}
                </fieldset>
                <button className="primary-button" disabled={busy || !userForm.roleIds.length || !userForm.branchIds.length} type="submit">
                  {busy ? "Guardando…" : userPanel.kind === "create" ? "Crear usuario" : "Guardar cambios"}<span aria-hidden="true">↗</span>
                </button>
              </form>
            )}
          </aside>
        </section>
      ) : (
        <section className="cash-layout">
          <article className="panel">
            <div className="panel-heading"><div><p className="section-kicker">Permisos</p><h2>Roles</h2></div><button className="secondary-button" onClick={() => openRole({ kind: "create" })} type="button">+ Nuevo rol</button></div>
            <div className="order-list">
              {roles.map((role) => (
                <article className="order-card role-card" key={role.id}>
                  <div className="order-card-head">
                    <div><strong>{role.name}</strong><small>{role.description || (role.isSystem ? "Rol predefinido" : "Rol personalizado")}</small></div>
                    <span className={`order-status ${role.isSystem ? "order-open" : "order-partially_received"}`}>{role.isSystem ? "Predefinido" : "Personalizado"}</span>
                  </div>
                  <div className="chip-row">
                    {role.permissions.map((code) => <span className="chip" key={code}>{permissionLabels.get(code) ?? code}</span>)}
                  </div>
                  <div className="order-card-foot">
                    <small className="action-muted">{role.users} {role.users === 1 ? "usuario" : "usuarios"}</small>
                    <div className="user-actions">
                      {role.isSystem
                        ? <button className="row-action" onClick={() => openRole({ kind: "view", role })} type="button">Ver permisos</button>
                        : <>
                          <button className="row-action" onClick={() => openRole({ kind: "edit", role })} type="button">Editar</button>
                          <button className="row-action row-action-danger" disabled={busy || role.users > 0} onClick={() => {
                            if (window.confirm(`¿Eliminar el rol ${role.name}?`)) {
                              void run(async () => { await deleteRole(role.id); return "Rol eliminado."; });
                            }
                          }} title={role.users > 0 ? "Quita este rol a sus usuarios antes de eliminarlo" : undefined} type="button">Eliminar</button>
                        </>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <aside className="panel cash-form-panel">
            {rolePanel.kind === "none" ? (
              <div className="inventory-action-placeholder billing-placeholder">
                <span className="empty-symbol">✦</span>
                <h2>Roles a tu medida</h2>
                <p>Los roles predefinidos no se modifican. Crea uno personalizado si necesitas otra combinación de permisos.</p>
              </div>
            ) : (
              <form className="cash-form" onSubmit={submitRole}>
                <div className="panel-heading"><div><p className="section-kicker">{rolePanel.kind === "view" ? "Rol predefinido" : rolePanel.kind === "edit" ? "Edición" : "Nuevo"}</p><h2>{rolePanel.kind === "create" ? "Nuevo rol" : rolePanel.role.name}</h2></div><button aria-label="Cerrar" className="close-action" onClick={() => setRolePanel({ kind: "none" })} type="button">×</button></div>
                {rolePanel.kind !== "view" ? (
                  <>
                    <label className="field"><span>Nombre</span><input maxLength={120} minLength={2} required value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} placeholder="Ej. Supervisor de caja" /></label>
                    <label className="field"><span>Descripción <small>opcional</small></span><input maxLength={255} value={roleForm.description} onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })} /></label>
                  </>
                ) : null}
                {permissionGroups.map(([module, group]) => (
                  <fieldset className="check-fieldset" key={module}>
                    <legend>{module}</legend>
                    {group.map((permission) => {
                      const allowed = mine.has(permission.code);
                      return (
                        <label className={`check-option ${allowed || rolePanel.kind === "view" ? "" : "is-locked"}`} key={permission.code}>
                          <input checked={roleForm.permissionCodes.includes(permission.code)} disabled={rolePanel.kind === "view" || !allowed} onChange={() => setRoleForm({ ...roleForm, permissionCodes: toggle(roleForm.permissionCodes, permission.code) })} type="checkbox" />
                          <span><strong>{permission.label}</strong>{!allowed && rolePanel.kind !== "view" ? <small>No lo tienes: no puedes otorgarlo</small> : null}</span>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
                {rolePanel.kind !== "view" ? (
                  <button className="primary-button" disabled={busy || !roleForm.permissionCodes.length} type="submit">{busy ? "Guardando…" : rolePanel.kind === "edit" ? "Guardar rol" : "Crear rol"}<span aria-hidden="true">↗</span></button>
                ) : null}
              </form>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
