# Galería

Demo de galería de imágenes con **personalización** y **animaciones de grado profesional**. Es una
demo de vitrina dentro del portafolio DvloprBn (vivirá en `galeria.dvloprbn.dev`) — no un producto,
pero construida con estándar de producción: sin atajos simulados, seguridad como prioridad #1, y
documentada al grado de poder leerse entera.

## Qué tiene de verdad

| Área | Detalle |
|---|---|
| **Identidad** | Login en 3 pasos (correo → contraseña → 2FA), JWT `HS256` en cookie httpOnly + refresh con rotación, ventana de gracia y revocación en cascada. Roles **dinámicos** con jerarquía de autoridad (`level` / `max_count`). 2FA real (TOTP, secreto cifrado AES-256-GCM, 10 códigos de recuperación de un solo uso). Fuerza bruta contada en Redis (login, 2FA, reuso de refresh). |
| **Media** | Pipeline de subida seguro: validación por contenido (`sharp`), re-codificado que **elimina EXIF/GPS**, 4 derivados WebP responsivos, BlurHash, `limitInputPixels` contra decompression bombs, límite de tamaño en el interceptor. Almacenamiento abstraído: disco en desarrollo, Cloudinary en producción (con URLs firmadas para media privada). |
| **Galería y personalización** | Álbumes con visibilidad `public` / `unlisted` / `private`, layout (masonry / grid / justified / carousel) y tema (tokens de diseño validados). Enlaces de compartir con caducidad. Studio para gestionar todo desde el navegador; panel de administración de usuarios y roles. |
| **Frontend** | Galería pública SSR con los layouts en CSS puro, animación de entrada por `IntersectionObserver` (sin librería de animación), lightbox, `prefers-reduced-motion`. |

## Cómo está organizada la documentación

- **[Arquitectura](arquitectura.md)** — el mapa: stack, módulos, decisiones.
- **[Jerarquía de roles](roles.md)** — la regla de autoridad, en detalle.
- **[Seguridad](seguridad.md)** — la postura de seguridad y qué se ha probado.
- **[API (OpenAPI)](api.md)** — la referencia en vivo de todos los endpoints.

La documentación viva completa (decisiones, hallazgos, bitácora de aprendizaje) está en la raíz del
repositorio: `PLAN_DESARROLLO.md`, `DOCUMENTO_VIVO_ARQUITECTURA.md`, `APRENDIZAJE.md`,
`PRUEBAS_SEGURIDAD.md`, `BIBLIOGRAFIA.md`.
