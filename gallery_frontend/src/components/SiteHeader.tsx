'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ADMIN_ROLES, useAuth } from '@/lib/auth';
import { useSite } from '@/lib/site';

/**
 * Cabecera del sitio (portafolio). A la izquierda el nombre del autor (enlace a
 * la portada); en el centro/derecha la navegación pública — Trabajo, Sobre,
 * Contacto — y, según la sesión, los enlaces del gestor o el acceso.
 *
 * La sección pública (acceso y alta) queda **siempre visible**: es parte de la
 * demo. Dentro de una colección (`/g/...`) la cabecera se aparta para no
 * competir con el tema de la galería.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, logout } = useAuth();
  const site = useSite();

  const bare = pathname.startsWith('/g/');

  const onLogout = async () => {
    await logout();
    router.push('/');
  };

  /** Marca el enlace de la sección actual. */
  const active = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)
      ? { 'aria-current': 'page' as const }
      : {};

  return (
    <header className={`site-header${bare ? ' site-header--bare' : ''}`}>
      <Link href="/" className="site-header__brand">
        {site.ownerName || 'Estudio'}
      </Link>

      <nav className="site-header__nav">
        <Link href="/trabajo" {...active('/trabajo')}>
          Trabajo
        </Link>
        <Link href="/sobre" {...active('/sobre')}>
          Sobre
        </Link>
        <Link href="/contacto" {...active('/contacto')}>
          Contacto
        </Link>
      </nav>

      <div className="site-header__session">
        {loading ? null : me ? (
          <>
            <Link href="/studio" {...active('/studio')}>
              Gestor
            </Link>
            {ADMIN_ROLES.includes(me.roleName) ? (
              <Link href="/admin" {...active('/admin')}>
                Administración
              </Link>
            ) : null}
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
      </div>
    </header>
  );
}
