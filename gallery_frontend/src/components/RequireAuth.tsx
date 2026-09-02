'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * Envoltorio que exige sesión (y opcionalmente un rol de una lista) para
 * mostrar su contenido. Mientras carga muestra un aviso; si no cumple,
 * redirige a `/login` (guardando la ruta de destino) o a `/` si es un
 * problema de rol.
 *
 * El backend igualmente rechaza cada petición sin permiso — esto solo evita
 * pintar una pantalla que no va a funcionar.
 *
 * @param props.roles - Si se pasa, el rol del usuario debe estar en la lista.
 * @param props.children - Contenido protegido.
 */
export function RequireAuth({
  roles,
  children,
}: {
  roles?: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { me, loading } = useAuth();

  const roleOk = !roles || (me != null && roles.includes(me.roleName));

  useEffect(() => {
    if (loading) return;
    if (!me) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (!roleOk) {
      router.replace('/');
    }
  }, [loading, me, roleOk, router, pathname]);

  if (loading) {
    return <p className="page-note">Comprobando sesión…</p>;
  }
  if (!me || !roleOk) {
    return <p className="page-note">Redirigiendo…</p>;
  }
  return <>{children}</>;
}
