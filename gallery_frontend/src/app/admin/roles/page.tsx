'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ADMIN_ROLES } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';

interface RoleRow {
  role_id: number;
  name: string;
  description: string | null;
  level: number;
  max_count: number | null;
  is_system: boolean;
  _count: { users: number };
}

export default function RolesPage() {
  return (
    <RequireAuth roles={ADMIN_ROLES}>
      <Inner />
    </RequireAuth>
  );
}

function Inner() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [form, setForm] = useState({ name: '', description: '', level: 1, maxCount: '' });
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiFetch<RoleRow[]>('/roles').then(setRoles).catch(() => setRoles([]));

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await apiFetch('/roles', {
        method: 'POST',
        body: {
          name: form.name,
          description: form.description || undefined,
          level: Number(form.level),
          maxCount: form.maxCount ? Number(form.maxCount) : undefined,
        },
      });
      setForm({ name: '', description: '', level: 1, maxCount: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear.');
    }
  };

  const remove = async (id: number) => {
    if (!confirm('¿Borrar este rol?')) return;
    setError(null);
    try {
      await apiFetch(`/roles/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo borrar.');
    }
  };

  return (
    <main className="panel">
      <h1>Roles</h1>

      <section className="panel-section">
        <h2>Nuevo rol</h2>
        <form onSubmit={create} className="inline-form wrap">
          <input
            placeholder="nombre (minúsculas)"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="descripción"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <input
            type="number"
            placeholder="nivel"
            min={0}
            max={100}
            required
            value={form.level}
            onChange={(e) => setForm({ ...form, level: Number(e.target.value) })}
          />
          <input
            type="number"
            placeholder="máx. cuentas (opcional)"
            min={1}
            value={form.maxCount}
            onChange={(e) => setForm({ ...form, maxCount: e.target.value })}
          />
          <button type="submit">Crear</button>
        </form>
        {error && <p className="form-error">{error}</p>}
      </section>

      {roles === null ? (
        <p className="page-note">Cargando…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Nivel</th>
              <th>Máx.</th>
              <th>Cuentas</th>
              <th>Sistema</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.role_id}>
                <td>
                  <strong>{role.name}</strong>
                  {role.description ? (
                    <div className="muted">{role.description}</div>
                  ) : null}
                </td>
                <td>{role.level}</td>
                <td>{role.max_count ?? '—'}</td>
                <td>{role._count.users}</td>
                <td>{role.is_system ? 'sí' : 'no'}</td>
                <td>
                  {!role.is_system && role._count.users === 0 && (
                    <button
                      type="button"
                      className="link-button danger"
                      onClick={() => void remove(role.role_id)}
                    >
                      Borrar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
