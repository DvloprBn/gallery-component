'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ADMIN_ROLES } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';

interface SafeUser {
  userId: string;
  email: string;
  name: string | null;
  role: { roleId: number; name: string; level: number };
  isActive: boolean;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

interface RoleRow {
  role_id: number;
  name: string;
  level: number;
}

export default function UsuariosPage() {
  return (
    <RequireAuth roles={ADMIN_ROLES}>
      <Inner />
    </RequireAuth>
  );
}

function Inner() {
  const [users, setUsers] = useState<SafeUser[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [form, setForm] = useState({ email: '', name: '', roleId: 0 });
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [u, r] = await Promise.all([
      apiFetch<SafeUser[]>('/users').catch(() => [] as SafeUser[]),
      apiFetch<RoleRow[]>('/roles').catch(() => [] as RoleRow[]),
    ]);
    setUsers(u);
    setRoles(r);
    if (form.roleId === 0 && r.length > 0) {
      setForm((f) => ({ ...f, roleId: r[0].role_id }));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    try {
      const res = await apiFetch<{ welcomeEmailSent: boolean; tempPassword?: string }>(
        '/users',
        {
          method: 'POST',
          body: { email: form.email, name: form.name, roleId: Number(form.roleId) },
        },
      );
      setForm({ email: '', name: '', roleId: roles[0]?.role_id ?? 0 });
      setNotice({
        ok: true,
        text: res.tempPassword
          ? `Cuenta creada. Contraseña temporal: ${res.tempPassword}`
          : 'Cuenta creada. Se envió el correo de bienvenida.',
      });
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'No se pudo crear.',
      });
    }
  };

  const patchUser = async (id: string, body: { roleId?: number; isActive?: boolean }) => {
    setNotice(null);
    try {
      await apiFetch(`/users/${id}`, { method: 'PATCH', body });
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : 'No se pudo actualizar.',
      });
    }
  };

  return (
    <main className="panel">
      <h1>Usuarios</h1>

      <section className="panel-section">
        <h2>Alta administrativa</h2>
        <form onSubmit={create} className="inline-form wrap">
          <input
            type="email"
            placeholder="correo"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            placeholder="nombre"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            value={form.roleId}
            onChange={(e) => setForm({ ...form, roleId: Number(e.target.value) })}
          >
            {roles.map((r) => (
              <option key={r.role_id} value={r.role_id}>
                {r.name} (nivel {r.level})
              </option>
            ))}
          </select>
          <button type="submit">Crear cuenta</button>
        </form>
        {notice && (
          <p className={notice.ok ? 'form-ok' : 'form-error'}>{notice.text}</p>
        )}
      </section>

      {users === null ? (
        <p className="page-note">Cargando…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Correo</th>
              <th>Nombre</th>
              <th>Rol</th>
              <th>2FA</th>
              <th>Activa</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId} className={u.isActive ? '' : 'row--muted'}>
                <td>{u.email}</td>
                <td>{u.name ?? '—'}</td>
                <td>
                  <select
                    defaultValue={u.role.roleId}
                    onChange={(e) =>
                      void patchUser(u.userId, { roleId: Number(e.target.value) })
                    }
                  >
                    {roles.map((r) => (
                      <option key={r.role_id} value={r.role_id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{u.totpEnabled ? 'sí' : 'no'}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={u.isActive}
                    onChange={(e) =>
                      void patchUser(u.userId, { isActive: e.target.checked })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
