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

  /** Marca el enlace activo (para el estilo de "sección actual"). */
  const active = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)
      ? { 'aria-current': 'page' as const }
      : {};

  return (
    <nav className="site-nav">
      <Link href="/" className="site-nav__brand">
        Galería
      </Link>
      <span className="site-nav__spacer" />
      {loading ? null : me ? (
        <>
          <Link href="/studio" {...active('/studio')}>
            Studio
          </Link>
          {ADMIN_ROLES.includes(me.roleName) ? (
            <Link href="/admin" {...active('/admin')}>
              Administración
            </Link>
          ) : null}
          <Link href="/cuenta" {...active('/cuenta')}>
            {me.email}
          </Link>
          <button type="button" className="link-button" onClick={onLogout}>
            Salir
          </button>
        </>
      ) : (
        <>
          <Link href="/login" {...active('/login')}>
            Entrar
          </Link>
          <Link href="/registro" {...active('/registro')}>
            Crear cuenta
          </Link>
        </>
      )}
    </nav>
  );
}
