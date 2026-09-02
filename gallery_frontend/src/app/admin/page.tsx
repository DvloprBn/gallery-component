'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ADMIN_ROLES, useAuth } from '@/lib/auth';
import { RequireAuth } from '@/components/RequireAuth';

export default function AdminHome() {
  return (
    <RequireAuth roles={ADMIN_ROLES}>
      <Inner />
    </RequireAuth>
  );
}

function Inner() {
  const { me } = useAuth();
  return (
    <main className="panel">
      <h1>Administración</h1>
      <p className="muted">
        Sesión: {me?.email} — rol <strong>{me?.roleName}</strong> (nivel {me?.roleLevel}).
        Solo puedes gestionar cuentas y roles de nivel inferior al tuyo.
      </p>
      <ul className="admin-links">
        <li>
          <Link href="/admin/usuarios">Usuarios →</Link>
        </li>
        <li>
          <Link href="/admin/roles">Roles →</Link>
        </li>
        <li>
          <Link href="/studio/ajustes">Ajustes del sitio →</Link>
        </li>
        <li>
          <Link href="/studio/mensajes">Mensajes →</Link>
        </li>
      </ul>
    </main>
  );
}
