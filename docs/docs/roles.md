# Jerarquía de roles

Los roles son **dinámicos** (una tabla editable en caliente, no un enum de Postgres). Cada rol
tiene un **nivel de autoridad** (`level`) y, opcionalmente, un **cupo** de cuentas activas
(`max_count`).

## Roles sembrados

| Rol | Nivel | Cupo | Descripción |
|---|---|---|---|
| `usuario` | 0 | — | Cuenta pública, dueña de sus propios álbumes |
| `staff` | 1 | — | Apoyo operativo |
| `manager` | 2 | — | Gestión de un área |
| `admin` | 3 | — | Administración de cuentas y roles |
| `director` | 4 | 1 | Dirección — cargo de una sola persona |
| `super` | 5 | 1 | Superadministrador — cargo de una sola persona |

Los seis están marcados `is_system`: no se pueden borrar, y `director`/`super` tampoco cambiar de
nivel ni de cupo.

## La regla

> Un actor solo puede **crear o gestionar** una cuenta o un rol de nivel **estrictamente menor** al
> suyo — ni siquiera para desactivarla.

Consecuencias:

- Un `admin` (nivel 3) puede dar de alta `manager`/`staff`, nunca otro `admin` ni `director`/`super`.
- Nadie puede crearse un rol de nivel igual o mayor al suyo (sería fabricarse un jefe imaginario
  con más autoridad — escalada de privilegios).
- `max_count` cuenta solo cuentas **activas**. Desactivar al `director` libera el cupo para nombrar
  uno nuevo sin borrar el historial. Al reasignarle su mismo rol a una cuenta existente, esa cuenta
  se excluye de su propio conteo.

## Dónde se aplica

- **Puerta gruesa** (`@Roles('admin','director','super')`) en `UsersController` y `RolesController`.
- **Regla fina** en `UsersService.assertCanManageRole` y su espejo en `RolesService.create`/`update`.
- El nivel del actor se lee **en vivo de la base de datos** en cada petición (`JwtStrategy`), nunca
  del token firmado — cambiar un rol surte efecto de inmediato.

## Cuentas de prueba

Una por rol, contraseña `TestOnly123!`: `usuario+gallery@example.com` … `super+gallery@example.com`.
