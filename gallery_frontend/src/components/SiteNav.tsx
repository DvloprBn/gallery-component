'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ADMIN_ROLES, useAuth } from '@/lib/auth';

/**
 * Barra de navegación del sitio. Se oculta dentro de la galería pública
 * (`/g/...`) para no ensuciar la vista de la demo. Muestra enlaces distintos
 * según haya sesión y según el rol.
 */
export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, logout } = useAuth();

  if (pathname.startsWith('/g/')) {
    return null;
  }

  const onLogout = async () => {
    await logout();
    router.push('/');
  };

  return (
    <nav className="site-nav">
      <Link href="/" className="site-nav__brand">
        Galería
      </Link>
      <span className="site-nav__spacer" />
      {loading ? null : me ? (
        <>
          <Link href="/studio">Studio</Link>
          {ADMIN_ROLES.includes(me.roleName) ? (
            <Link href="/admin">Administración</Link>
          ) : null}
          <Link href="/cuenta">{me.email}</Link>
          <button type="button" className="link-button" onClick={onLogout}>
            Salir
          </button>
        </>
      ) : (
        <>
          <Link href="/login">Entrar</Link>
          <Link href="/registro">Crear cuenta</Link>
        </>
      )}
    </nav>
  );
}
