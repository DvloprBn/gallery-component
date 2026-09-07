# Plan de Desarrollo — Galería

> Estrategia, alcance y decisiones. Nada de esto es código de aplicación todavía — estamos en
> **modo diseño** (ver `CLAUDE.md`). Este documento se actualiza conforme se resuelven las
> decisiones abiertas de §4, no de una sola vez.

Última actualización: **2026-09-01** — documentación inicial del proyecto.

---

## §0. Propósito y estándar de calidad

**Demo de vitrina dentro del portafolio DvloprBn** (`projects/dvlopr-bn`), mismo dominio — no es un
producto ni se despliega solo. Su función es comercial: que un cliente potencial la abra, vea
ingeniería de producción real y contrate más trabajo. Se desarrolla aquí de forma autónoma (mismo
patrón que OmniUser) y se integra/enlaza desde el portafolio. Dos objetivos, ninguno opcional:

1. **Legibilidad total.** El dueño tiene que poder leer y entender *todo* el código sin ayuda
   externa, al grado de modificarlo solo. Por eso el estándar de comentarios está en el máximo
   (TSDoc en cada función no trivial — ver §7) y existe una bitácora didáctica de primera clase
   (`APRENDIZAJE.md`).
2. **Base reutilizable real.** Diseñado desde el día uno para poder copiarse casi tal cual a un
   proyecto de cliente futuro (ver §5).

Consecuencia en el estándar de calidad:

- **Sin atajos simulados.** Integraciones reales siempre (almacenamiento de objetos, procesamiento
  de imagen con `sharp`, correo transaccional).
- **Buenas prácticas de seguridad desde el primer commit de código**, no "ya lo arreglamos después".
- **Debe pasar pruebas de seguridad exhaustivas** — OWASP API Security Top 10 completo contra cada
  endpoint real (`PRUEBAS_SEGURIDAD.md`).
- **Debe quedar documentado** al nivel de que el dueño lo lea solo y lo entienda.

---

## §1. Qué es este proyecto

Una **galería de imágenes** con personalización y animaciones de grado profesional, presentada como
el **portafolio real de un fotógrafo**. Reencuadre en dos pasos: Fase 10 la convirtió de galería
genérica en portafolio; a partir de aquí demuestra el **kit completo que un fotógrafo necesita para
publicar, proteger y vender su obra** — sin regalarla ni depender de plataformas de terceros. Los
datos son ficticios (es una demo), pero **cada función es real y funcional**, sin atajos simulados.

Cuatro superficies:

| Superficie | Para quién | Qué hace |
|---|---|---|
| **Sitio público** | Cualquier visitante | Portada editorial con hero, `/trabajo` (colecciones), `/sobre`, contacto en un clic desde cualquier lugar; la identidad la fija `site_settings` |
| **Galería pública** | Cualquier visitante | Ver una **selección curada** de una colección: layout elegido por el dueño, animaciones, lightbox, imágenes responsivas y perezosas — **siempre con marca de agua**, nunca el original de alta resolución |
| **Gestor del sitio** | Dueño (usuario autenticado) | Crear colecciones, subir a un archivo y **curar** la selección visible, reordenar, elegir layout/tema/visibilidad, marcar "destacada", configurar marca de agua; bandeja de **contacto y de solicitudes de licencia**; ajustes de identidad (roles `admin`+) |
| **Panel de administración** | Roles administrativos | Gestión de usuarios y de roles dinámicos, respetando la jerarquía de autoridad |

**Qué es y qué no es.** No es una plataforma de stock ni una red social de fotos. Es el sitio
**propio** de un autor: presenta su trabajo, **protege** los archivos (marca de agua, derechos
embebidos, el original bueno tras un muro) y permite **licenciarlos** (solicitud → cotización →
entrega firmada de un solo uso). El cobro dentro del sitio es **opcional y posterior** (§4 D12). La
sección pública de acceso (entrar / crear cuenta) se mantiene visible: es parte de la demostración.

### Principios de portafolio (adoptados de la investigación del dueño, 2026-09-02)

| Principio | Estado en el proyecto |
|---|---|
| **Mostrar menos de lo que se tiene** — la imagen más débil fija el estándar | Estados de publicación por imagen (`archivada` / `borrador` / `publicada`) + **selección curada** por colección; el archivo completo no se lista. (Fase 5 ampliada + Fase 11.) |
| **Abrir con una imagen, no con un menú** | ✅ Hecho — hero a sangre completa (Fase 10). |
| **Contacto en un clic desde cualquier lugar** | Afordancia de contacto persistente (no solo enlace en el menú) + contacto/solicitud desde dentro de la galería. (Fase 10 pulido + Fase 12.) |
| **Poseer el dominio** | ✅ Decidido (D8) — la demo vive en `galeria.dvloprbn.dev`; un despliegue real para un autor usaría su dominio raíz. |
| **Agrupar por tipo, no por cliente** | ✅ Alineado — las colecciones son por género/tema, nunca "Cliente X". Principio explícito. |
| **Separar comercial de editorial** | Opcional — campo `category` en `albums` (§4 D13); IA plana mientras haya una sola audiencia. |
| **Un scroll por especialidad; galerías aparte al pasar de dos** | ✅ `/trabajo` (índice) + `/g/[slug]`; sin anidamiento, el visitante nunca adivina en qué galería está. |

Lo demás de esa investigación (encontrar la voz, definir audiencia, secuenciar, iterar) es
**proceso del fotógrafo**, no funcionalidad del sitio; se apoya con lo que ya existe (reordenado por
arrastre, enlaces de compartir para segundas opiniones, edición fácil desde el gestor).

---

## §2. Alcance de la primera versión

### Capa de identidad (patrón probado, se explica completo en `DOCUMENTO_VIVO_ARQUITECTURA.md`)
- Registro + login con correo/contraseña.
- **Login en 3 pasos, en pantallas separadas** (correo → contraseña → segundo factor si aplica) —
  nunca un formulario único.
- JWT de acceso en cookie httpOnly + refresh token con rotación y ventana de gracia; revocación
  en cascada si se detecta reuso de un token robado.
- Roles **dinámicos** (tabla `roles` editable en caliente) con **jerarquía de autoridad**
  (`level` / `max_count`): nadie puede crear ni gestionar una cuenta o un rol de su mismo nivel
  o superior.
- Cambio y recuperación de contraseña.
- Rate limiting dedicado, detección de fuerza bruta (login y 2FA), `ValidationPipe` con whitelist
  estricta, cabeceras de seguridad, CORS explícito.
- **2FA real (TOTP, RFC 6238)** — QR real, secreto cifrado en reposo (AES-256-GCM), códigos de
  recuperación de un solo uso. *(Confirmar en §4, decisión D5.)*

### Capa de media — el núcleo nuevo del proyecto
- **Pipeline de subida seguro** (ver §8 y `DOCUMENTO_VIVO_ARQUITECTURA.md` §2):
  validación por **contenido real** (magic bytes), límite de tamaño en el interceptor,
  re-encode obligatorio con `sharp`, tiro de metadatos EXIF/GPS, rechazo o sanitización de SVG,
  nombre de archivo aleatorio, `limitInputPixels` contra decompression bombs.
- **Almacenamiento abstraído** (`StorageService`): driver de disco local en desarrollo, driver
  S3-compatible en producción. *(Confirmar en §4, decisión D3.)*
- **Derivados responsivos**: por cada imagen original se generan variantes (thumb / small /
  medium / large) en formato moderno (WebP/AVIF) — nunca se sirve el archivo original a un
  contenedor de 300 px.
- **Placeholder** (blurhash o dominante) para evitar layout shift mientras carga.
- **Servido con control de acceso**: imágenes de álbumes privados solo por **URL firmada con
  expiración**; nunca una ruta adivinable.

### Capa de galería y personalización
- Modelo `albums` / `media` / `media_variants` (ver schema en `DOCUMENTO_VIVO_ARQUITECTURA.md`).
- Visibilidad por álbum: `public` / `unlisted` (por enlace) / `private`.
- **Estado de publicación por imagen**: `archivada` (subida pero fuera del portafolio) / `borrador`
  / `publicada`. La galería pública muestra solo `publicada`; el gestor ve todo. Sostiene el
  principio "mostrar menos de lo que se tiene".
- Layout por álbum: `masonry` / `justified` / `grid` / `carousel` / `book` (fotolibro, Fase 15).
- Tema por álbum: objeto de tokens de diseño (colores, tipografía, espaciado, radios) — editable
  en el Studio, **expuesto completo al crear el álbum, no "crear y luego editar"**.
- (Opcional, §4 D13) `category` por álbum: `editorial` / `comercial` / `personal` — para agrupar
  `/trabajo` cuando haya dos audiencias que se autoseleccionan.

### Capa de protección de la obra — *el fotógrafo deja de regalar sus fotos*
- **Marca de agua** (§4 D9) aplicada por el **pipeline del servidor** a **todos** los derivados
  públicos (thumb → large). Configurable desde el gestor:
  - Un **formulario en el gestor para subir la imagen de marca de agua** (PNG con transparencia).
  - Si no se sube ninguna, se estampa un **texto** (el aviso de `site_settings`, p. ej. `© Mara Solís`).
  - Se aplica como **patrón diagonal repetido tenue** (opción de esquina), con opacidad ajustable.
  - **No desactivable** para colecciones `public`. La **entrega bajo licencia** (§ siguiente) sale
    **sin** marca.
  - El **original de resolución completa nunca se sirve en público** — solo derivados marcados; el
    archivo limpio vive tras el muro de licenciamiento y solo sale por URL firmada de un solo uso.
- **Registro de derechos por imagen + embebido de metadatos** (§4 D10). Dos partes:
  1. **Captura**: el gestor guarda por foto — titular del copyright, autor/crédito, año de primera
     publicación, aviso de derechos, término de licencia por defecto, descripción, palabras clave.
     Valores por defecto tomados de `site_settings`, editables por imagen.
  2. **Embebido**: el pipeline deja de "tirar TODO el EXIF" y pasa a **quitar solo lo sensible**
     (GPS, número de serie de cámara, datos personales del disparo) e **incrustar IPTC/XMP** con
     esos campos de derechos en **cada archivo servido** (derivados públicos con marca *y* entrega
     limpia bajo licencia). Es señal **legal legible por máquina**, no DRM. `PRUEBAS_SEGURIDAD.md`
     F11 se actualiza: "sin GPS/serie" sigue siendo obligatorio; "sin ningún metadato" se sustituye
     por "solo metadatos de derechos, nunca de ubicación/equipo".
- **Disuasores de copia** en el frontend: bloquear arrastre y menú contextual sobre las imágenes,
  capa transparente sobre la figura. Documentado con honestidad: son **disuasores**, no control de
  acceso — el control real es que el archivo bueno no se sirve y que lo que sí se sirve va marcado.
- **Aviso de copyright** visible: en el pie del sitio y junto a cada foto en el lightbox
  (texto de `site_settings`).
- Fuera de alcance por ahora: marca de agua **forense/invisible** (esteganográfica) para rastrear
  filtraciones — se menciona como evolución posible, no se construye.

### Capa de licenciamiento y entrega — *el fotógrafo puede vender*
- Modelo `license_requests` / `licenses` / `delivery_tokens`.
- Flujo público: desde una foto → elegir **uso** (`editorial` / `comercial` / `social` /
  `impresión`) y alcance → **solicitud** (nombre, correo, descripción del uso, presupuesto) →
  llega a la bandeja del gestor (misma bandeja que contacto, otro tipo).
- Flujo del gestor: revisar la solicitud → **cotizar** (precio + condiciones + vigencia) → al
  aceptar el cliente, se emite una `license` y un `delivery_token`: **URL firmada de un solo uso y
  con caducidad** que entrega el **archivo original limpio** (sin marca de agua, con los metadatos
  de derechos y de licenciatario embebidos).
- Registro consultable de licencias emitidas (qué foto, a quién, qué uso, vigencia) — sirve de
  prueba y de historial.
- **Rail de pago** (§4 D12): la **Fase 12 no cobra en el sitio** (solicitud → cotización → entrega;
  el pago se acuerda fuera). La **Fase 13** añade **checkout de Stripe en modo test** tras un
  feature flag — **diferida ~15 días** (hasta tener cuenta de Stripe, ≈2026‑09‑17). El **proyecto
  padre** (`projects/dvlopr-bn`) es el que cobra de verdad; esta demo solo demuestra el flujo con
  claves **de prueba**. Hoy el proyecto padre no tiene claves de Stripe → el módulo se cablea
  **desactivado** y se conecta cuando existan. **Nunca** claves `live` en este repo.
- **Venta de impresiones**: fuera de la primera versión (§4 D11) — es otro producto (inventario,
  envío); se evalúa después de la licencia digital.

### Capa de animación
- Librería a confirmar (§4, decisión D4). Presupuesto de rendimiento definido antes de construir.
- `prefers-reduced-motion` respetado en todo: entrada de elementos, lightbox, hover.
- Imágenes con carga perezosa por defecto; `next/image` (o equivalente) con el tamaño real.

### Frontend
- Galería pública (`/g/[slug]`), landing, login/registro en pasos, `/cuenta` (2FA), `/studio`,
  `/admin`, y `/dev/cuentas-de-prueba` **solo si `NODE_ENV !== 'production'`** (login real, nunca
  un bypass).

---

## §3. Stack

Mismo stack en todas las capas, sin variarlo sin confirmarlo:

| Capa | Tecnología |
|---|---|
| Backend | **NestJS 11** + **Prisma 7** + **PostgreSQL 18** |
| Frontend | **Next.js 16** + **React 19** |
| Cache / rate limiting / colas | **Redis** |
| Procesamiento de imagen | **`sharp`** (libvips) |
| Detección de tipo real | **`file-type`** (magic bytes) |
| Almacenamiento de objetos | Driver disco (dev) / **Cloudinary** (prod) — `cloudinary` SDK, tras el pipeline propio de `sharp` |
| Animación (frontend) | **Framer Motion** + CSS puro — ver §4 D4 |
| Infra local | **Docker Compose** |
| Documentación autogenerada | **MkDocs Material** + **Swagger UI** (`@nestjs/swagger`) + **Compodoc** |

---

## §4. Decisiones — confirmadas (2026-09-01)

> El dueño confirmó ("adelante, continúa") avanzar con los defaults propuestos. Quedan como
> decisiones firmes; cualquiera se puede revisar más adelante por migración, pero el código ya
> se construye sobre ellas. **D3 resuelto como Cloudinary** (2026-09-01): la galería vive en el
> mismo dominio que el portafolio DvloprBn y **reutiliza su cuenta de Cloudinary y su llave de
> Resend** (mismas credenciales del `.env` de `projects/dvlopr-bn`, ya cargadas en `gallery/.env`).
> `CLOUDINARY_FOLDER=gallery` aísla los recursos de la galería dentro de esa cuenta compartida.

| # | Decisión | Resuelto | Por qué |
|---|---|---|---|
| **D1** | ¿Multiusuario o galería única? | ✅ **Multiusuario** — cada usuario es dueño de sus álbumes | Una galería única es un subcaso trivial del multiusuario; lo contrario obliga a rehacer el schema. Generaliza mejor a un cliente desconocido (§5). |
| **D2** | ¿Existen imágenes privadas? | ✅ **Sí** — visibilidad `public` / `unlisted` / `private` por álbum | Sin visibilidad privada no hay nada que proteger y las pruebas de seguridad de media (IDOR, URLs firmadas) pierden sentido. |
| **D3** | Almacenamiento | ✅ **Cloudinary** (storage + CDN + entrega), **cuenta compartida con el portafolio DvloprBn** — mismo dominio. `StorageService` abstracto: driver disco en dev, driver Cloudinary en prod, `CLOUDINARY_FOLDER=gallery` para aislar recursos. **La seguridad no se delega**: el backend hace validación por contenido + re-encode con `sharp` + tiro de EXIF *antes* de subir el derivado limpio. Credenciales ya cargadas en `gallery/.env`. | Reutilizar la cuenta del portafolio evita gestionar otra; correr el pipeline propio antes mantiene el control de seguridad (nunca confiar en el cliente). Riesgo asumido: un leak de la credencial en un proyecto afecta al otro — aceptable por ser el mismo ecosistema/dominio del dueño. |
| **D4** | Librería de animación | ✅ **Framer Motion** para orquestación; CSS puro para lo simple | Encaja natural con React 19 / Next 16, API declarativa, `prefers-reduced-motion` de fábrica. GSAP solo si hace falta control fino de timeline. |
| **D5** | 2FA (TOTP) para cuentas administrativas | ✅ **Incluido** desde la primera versión | Seguridad prioridad #1 salga o no a producción; el admin controla todo el contenido. Patrón probado, costo marginal bajo. |
| **D6** | Nombre del producto / paquetes | ✅ Paquetes: `gallery_backend` / `gallery_frontend`. Nombre de marca: **pendiente, no bloqueante** | Los nombres físicos ya son genéricos y seguros. El nombre comercial se fija en cualquier momento sin tocar código. |
| **D7** | ¿El repositorio será público? | ✅ **Sí** (portafolio) — seed con datos dummy y correos `@example.com` | La seguridad del proyecto nunca depende de que el código sea secreto. Nunca se commitea un correo/dato real. |
| **D8** | Modelo de integración con el portafolio DvloprBn | ✅ **Demo autónoma con su propio ambiente**, en el subdominio **`galeria.dvloprbn.dev`** (2026-09-01). Stack propio (su Postgres, su Redis, sus contenedores), identidad propia, frontend propio; el portafolio solo la **enlaza**. Un solo origen: el frontend en `galeria.dvloprbn.dev` y la API detrás del mismo host bajo `/api/*` (reverse proxy) → sin CORS en producción y **cookies host-only** en ese subdominio (no compartidas con el portafolio → más aislamiento). Lo único compartido con el portafolio: las cuentas de Cloudinary y Resend (D3) y el dominio raíz. | El dueño lo pidió explícito: "que tenga en lo más posible su propio ambiente", demo pero 100% funcional. Autonomía real = despliegue y borrado independientes, un incidente en un proyecto no toca al otro. |

**Decisiones ya tomadas (no abiertas):**
- Stack idéntico al de §3 — pedido explícito, no se varía.
- Roles **dinámicos**, no un enum fijo (generaliza mejor a un cliente desconocido).
- Login "estilo Google" en pasos separados desde el arranque (solo la UX; OAuth real sería una
  fase posterior aparte, solo si se pide).
- Repositorio git propio desde el primer commit.

### Decisiones D9–D13 — reencuadre a "portafolio que protege y vende" (resueltas 2026-09-02)

> El dueño reencuadró el proyecto: no una galería más, sino la demo del kit real para **publicar,
> proteger y vender** obra fotográfica. Estas cinco decisiones se plantearon como abiertas y el
> dueño las cerró el mismo día (respondiendo a las recomendaciones del arquitecto). Detalle
> técnico y *por qué* de cada una en `DOCUMENTO_VIVO_ARQUITECTURA.md` §12.

| # | Decisión | Resuelto | Por qué |
|---|---|---|---|
| **D9** | Marca de agua | ✅ **Obligatoria en todo lo `public`, configurable desde el gestor.** El gestor tiene un **formulario para subir la imagen de marca de agua** (PNG con transparencia); si no se sube ninguna, se usa un texto (el de `site_settings`, p. ej. `© Mara Solís`). El pipeline la estampa en **todos** los derivados públicos (thumb → large) como patrón diagonal repetido tenue (opción de esquina). **No** se puede desactivar para `public`; la entrega bajo licencia sí sale **sin** marca. | Una marca opcional se termina olvidando justo en la foto que importa. El logo subido es lo que un fotógrafo espera; el texto es un buen respaldo que funciona desde el minuto cero. Estampar en el servidor (no en CSS) es lo único que un tercero no puede quitar. |
| **D10** | Captura y embebido de datos de derechos | ✅ **Sí, captura completa.** Dos partes: **(1) registro de derechos por imagen** — el gestor captura y guarda por foto: titular del copyright, autor/crédito, año de primera publicación, aviso de derechos, término de licencia por defecto, descripción y palabras clave. **(2) embebido**: el pipeline deja de "tirar todo el EXIF" y pasa a **quitar solo lo sensible** (GPS, número de serie de cámara, datos personales del disparo) e **incrustar IPTC/XMP** con esos campos de derechos en **cada archivo servido** (derivados públicos con marca y entrega limpia bajo licencia). | "Proteger la obra" no es solo la marca visible: es que el archivo lleve *pegado*, de forma legible por máquina y por tribunales, quién es el dueño y bajo qué términos se puede usar. Quitar GPS/serie sigue siendo obligatorio (privacidad del fotógrafo). |
| **D11** | Alcance de venta | ✅ **Provisional: solo licencia digital** (el dueño investigará más). Tipos de uso: `editorial` / `comercial` / `social` / `impresion` (este último = "licencia para imprimir", sin inventario ni envío). Venta de impresiones físicas: fuera de alcance hasta nueva decisión. | Empezar por lo digital deja el flujo completo (solicitud → cotización → entrega firmada) funcionando sin meter inventario, envíos ni impuestos. El modelo de datos no cierra la puerta a impresiones. |
| **D12** | Rail de pago | ✅ **Fase 12 sin pago en el sitio** (solicitud → cotización → entrega; el pago se acuerda fuera). **Fase 13: checkout de Stripe en modo test**, detrás de un feature flag, **diferida ~15 días** (hasta tener la cuenta de Stripe, ≈2026‑09‑17). El **proyecto padre** (`projects/dvlopr-bn`, el portafolio) es el que cobrará de verdad; esta demo solo demuestra el flujo con claves **de prueba**. **El proyecto padre aún no tiene claves de Stripe** — no hay nada que reutilizar hoy; se cablea el módulo desactivado y se conectan las claves de test cuando existan. **Nunca** claves `live` en este repo (es público). | Un cobro real en un repo público con seguridad como prioridad #1 no aporta a una demo y sí añade superficie. El flujo de negocio (cotizar, licenciar, entregar) se demuestra entero sin tarjeta; el checkout test se añade encima cuando haya cuenta. |
| **D13** | Separación comercial / editorial | ✅ **Campo `category` en `albums`** (`editorial` / `comercial` / `personal`), pero **IA plana** por ahora: `/trabajo` no se agrupa mientras la persona demo (documental) tenga una sola audiencia. Se activa la agrupación sin migración el día que haya >1 categoría en uso. | El campo cuesta casi nada ahora y evita una migración incómoda después; agrupar la navegación antes de que haga falta solo añade una decisión al visitante. |
| **D14** | Video en el portafolio | ✅ **Sí, con el mismo estándar que las fotos** (validación por contenido, re-encode obligatorio, marca de agua del servidor, licenciamiento y entrega de un solo uso) **y** reproducción inline en la galería. Decisiones técnicas resueltas por el arquitecto (el dueño delegó): transcodificación con **`ffmpeg` propio** (no un servicio de pago — mismo principio que `sharp`: el pipeline de seguridad corre antes del almacenamiento); entrega **HLS adaptativa** para ver + **master MP4 limpio de un solo uso** para la licencia; modelo de datos **unificado `media`** con discriminador `kind` (`photo`/`video`) en vez de una tabla `videos` aparte. ✅ **Construida** (Fases 14a–14d, `DOCUMENTO_VIVO_ARQUITECTURA.md` §19–§23). | El video es exactamente el tipo de obra que se roba y se licencia; dejarlo "solo mostrar" contradiría la tesis del proyecto. `ffmpeg` propio evita un costo recurrente y una dependencia externa en una función central. El refactor a `media` se hace ahora que **no hay producción ni datos reales** (el seed es convergente) — retrofitear después es justo lo que se quiere evitar. HLS para ver + un archivo para comprar: cada transporte encaja con su uso, igual que "derivados públicos vs. original entregado una vez" en las fotos. |
| **D15** | Layout **"libro"** (fotolibro que se hojea) | ✅ **Sí, como un layout de álbum más** (`albums.layout = 'book'`, junto a masonry/justified/grid/carousel) — no una página suelta. Inspirado en la sección "The Story" de nois7.com/world-of-dreams. Decisiones (elegidas por el dueño): **pase de página fotorrealista** (hoja que se curva, con sombra) → se **bundlea `page-flip` (StPageFlip, MIT, ~30 KB) en modo HTML** — mantiene `<img>` reales en el DOM, así que `srcset`/BlurHash/lazy/SEO siguen igual; **scroll "cinematográfico"** — la sección se **fija** (`sticky`) y las páginas pasan según el progreso de scroll; **dos imágenes por pliego** (página izquierda + derecha), portada con el título del álbum y los colores del `theme`, contraportada con un CTA de licencia. **Móvil**: una página por pantalla, se pasa con gesto (no scroll fijo). **`prefers-reduced-motion` / sin JS / si la librería falla → cae a `grid`** (mismas imágenes, sin 3D). Diseño en `DOCUMENTO_VIVO_ARQUITECTURA.md` §24; **construida** (§25–§28, Fase 15 completa; pendiente transversal: CWV y prueba visual en navegador real). | El proyecto ya tiene layouts por álbum: "libro" es uno más y cualquier colección puede usarlo. Un pase de página de calidad no es viable en CSS puro; `page-flip` en modo HTML da el efecto sin perder el pipeline de imagen. El scroll fijo es lo que hace "el momento", pero es frágil → la caída a `grid` no es opcional. |

---

## §5. Cómo se vuelve reutilizable

- Nombres genéricos en schema / variables / paquetes — nunca atados a una marca.
- Variables de entorno documentadas desde el `.env.example` inicial, no agregadas sobre la marcha.
- `docker-compose.yml` autocontenible, sin asumir que vive junto a otros proyectos.
- `StorageService` abstracto — cambiar de disco a S3 (o a otro proveedor) no toca la lógica de
  negocio, solo la configuración.
- Cada decisión de diseño se evalúa también contra: *"¿esto generaliza a un uso que no se parezca
  a una galería de fotos personal, o asume implícitamente su forma?"*

---

## §6. Datos de prueba

Sin negocio real detrás → se inventan datos libremente: usuarios ficticios, roles de ejemplo,
álbumes e imágenes de prueba (imágenes con licencia libre o generadas). El seed usa correos
`@example.com` — nunca un correo real, por la decisión D7.

- `prisma/seed.ts` (automático al arrancar el contenedor) — roles del catálogo + una cuenta por
  rol, contraseña `TestOnly123!`.
- `scripts/seed-portfolio.ts` (manual, **desde el host**) — persona ficticia "Mara Solís" y
  6 colecciones públicas (244 fotos = **todo** el contenido de la carpeta de origen) subidas por el
  pipeline real. Convergente (borra y rehace cada colección). Es lo que da al sitio su aspecto de
  portafolio poblado. Requiere `UPLOAD_MAX_UPLOADS_PER_HOUR` alto en dev.

---

## §7. Estándar de documentación de código — requisito de primera clase

**Comentario de documentación real (TSDoc/JSDoc) en cada función/clase/módulo no trivial**:

- Qué hace, en una frase, sin repetir el nombre de la función.
- Qué espera cada parámetro — tipo + significado real, no solo el tipo.
- Qué regresa, incluidos los casos de error/excepción reales que puede lanzar.
- El *por qué*, cuando no sea obvio.

**Compodoc** (ver §9) parsea exactamente estos comentarios para generar el portal de documentación
del backend — escribirlos bien es lo que hace que ese portal sirva de verdad.

---

## §8. Pruebas de seguridad exhaustivas — documento aparte, replicable

`PRUEBAS_SEGURIDAD.md` cubre sistemáticamente el **OWASP API Security Top 10** contra cada endpoint
real que se construya. Además, un bloque específico de **seguridad de archivos** que una API normal
no tiene:

| Riesgo | Qué se prueba |
|---|---|
| Tipo falsificado | Subir un `.php`/`.svg`/polyglot renombrado a `.jpg` → rechazado por contenido real, no por extensión |
| Payload embebido | El re-encode con `sharp` destruye cualquier carga útil dentro del archivo original |
| SVG con script | Un `<svg><script>` → rechazado o sanitizado server-side, nunca servido tal cual |
| Decompression bomb | Imagen de dimensiones absurdas (ej. 50 000 × 50 000) → rechazada por `limitInputPixels` |
| DoS de subida | Archivo gigante → cortado por `limits.fileSize` en el interceptor, no bufferizado entero |
| IDOR de media | Cuenta A no puede leer una imagen privada de la cuenta B cambiando el `:id` de la URL |
| URL firmada | Una URL firmada expirada / manipulada → 403; una válida → 200 |
| Fuga de EXIF/GPS | La imagen servida no conserva coordenadas GPS ni metadatos personales del original |
| Enumeración de álbumes | Un álbum `private`/`unlisted` no aparece por fuerza bruta de slug/ID |

Cada prueba se documenta con: **qué vulnerabilidad prueba, por qué importa aquí, el comando/pasos
exactos para reproducirla, y qué resultado cuenta como "pasa"**. Arranca vacío (sin endpoints no
hay nada que probar) y se llena en paralelo a cada pieza que se construya.

---

## §9. Documentación automatizada

- **`docs/`** — portal MkDocs Material + `mkdocs-swagger-ui-tag`, sirviendo páginas de referencia
  + la spec OpenAPI en vivo.
- **`@nestjs/swagger`** en el backend — genera el spec OpenAPI real desde los decoradores de cada
  controller/DTO (`/api-json`), consumido en vivo por el portal.
- **Compodoc** — documentación autogenerada de módulos/servicios/grafo de dependencias del backend,
  parseando los comentarios TSDoc del §7.
- Ambos servicios **solo en `127.0.0.1`**, nunca expuestos más allá del host (un portal de
  documentación interna es, en los hechos, un mapa de la arquitectura — OWASP API8/API9).
- Se agregan al `docker-compose.yml` en cuanto exista un backend real que documentar.

---

## §10. Fases de construcción (cuando el dueño confirme salir de modo diseño)

| Fase | Entrega | Depende de |
|---|---|---|
| **1. Núcleo / infra** | Monorepo, `docker-compose.yml`, Postgres+Redis arriba, schema base migrado, healthcheck | — |
| **2. Identidad** | Auth (login 3 pasos, refresh/rotación, logout), roles dinámicos + jerarquía, 2FA | D5 |
| **3. Media core** | `StorageService`, pipeline de subida seguro, `sharp` + derivados, modelo álbum/imagen | D1, D2, D3 |
| **4. Galería pública** | `/g/[slug]`, layouts, `next/image`, carga perezosa, lightbox base | D1, D2 |
| **5. Personalización** | Studio: CRUD de álbumes, subida y reordenado, editor de tema/layout | D1 |
| **6. Animación grado profesional** | Capa de orquestación, presupuesto de rendimiento medido, `prefers-reduced-motion` | D4 |
| **7. Seguridad transversal** | `PRUEBAS_SEGURIDAD.md` completo contra cada endpoint, tests `jest` reales | fases 2–6 |
| **8. Docs autogenerada** | `docs/` (MkDocs+Swagger) + Compodoc en `docker-compose.yml` | fase 2+ |
| **9. Despliegue** | `docker-compose.prod.yml` + reverse proxy (Caddy) para `galeria.dvloprbn.dev` con la API bajo `/api/*`; Dockerfiles de producción multi-etapa; `.env` de producción (`STORAGE_DRIVER=cloudinary`, `NODE_ENV=production`, sin puertos de datos publicados); enlace desde el portafolio | D8, fases 1–7 |
| **10. Reencuadre como portafolio** | `site_settings` + `contact_messages` + `albums.featured`; endpoints `/site` y `/contact`; sitio público editorial (portada con hero, `/trabajo`, `/sobre`, `/contacto`); gestor con ajustes de identidad y bandeja; `scripts/seed-portfolio.ts` (persona "Mara Solís" + 6 colecciones) | fases 1–5 |
| **10b. Curación** ✅ *(completada 2026-09-03 — `DOCUMENTO_VIVO_ARQUITECTURA.md` §13)* | `images.status` (`published`/`draft`/`archived`, default `draft`); `PATCH /images/:id` acepta `status` + `POST /albums/:id/images/status` en bloque; `GET /g` y `/galleries` solo publicadas; portada/hero resilientes; gestor con selector de estado + selección múltiple + recuentos; seed cura (~81 de 244) | fase 10 |
| **11. Protección de la obra** ✅ *(completada 2026-09-04 — `DOCUMENTO_VIVO_ARQUITECTURA.md` §14)* | Formulario en el gestor para **subir la marca de agua** (PNG) + texto de respaldo; el pipeline la estampa en **todos** los derivados públicos; original de alta resolución **fuera** del servido público; **registro de derechos por imagen** + **embebido IPTC/XMP** (`exiftool`, sin GPS/serie); regeneración en segundo plano; disuasores de copia + aviso de derechos en el frontend | D9, D10, fases 3 y 10 |
| **12a. Solicitud de licencia** ✅ *(completada 2026-09-04 — `DOCUMENTO_VIVO_ARQUITECTURA.md` §15)* | Modelo `license_requests`; `POST /license-requests` (público, valida que la foto esté publicada y el álbum sea público, honeypot, throttle); `GET /license-requests` (bandeja de solo lectura, `admin`+); `/studio/licencias` en el gestor | D11, fases 10b y 11 |
| **12b. Cotizar** ✅ *(completada 2026-09-04 — `DOCUMENTO_VIVO_ARQUITECTURA.md` §16)* | El gestor responde una solicitud con precio + condiciones + vigencia de la oferta (`PATCH /license-requests/:id`); correo al solicitante; recotizar permitido | 12a |
| **12c. Emitir + entregar** ✅ *(completada 2026-09-04 — `DOCUMENTO_VIVO_ARQUITECTURA.md` §17)* | Modelo `licenses` / `delivery_tokens`; el gestor acepta una solicitud cotizada → se emite la licencia y una **URL de un solo uso** que entrega el archivo original limpio (con derechos + licenciatario embebidos). Incluyó corregir un hallazgo real: el original se filtraba en `GET /g/:slug` desde la Fase 3, sin que la Fase 11 lo hubiera notado | 12b, fase 11 |
| **12d. Frontend público + pulido** ✅ *(completada 2026-09-04 — `DOCUMENTO_VIVO_ARQUITECTURA.md` §18)* | Botón "Solicitar licencia" en la foto/lightbox con el formulario real; registro de licencias emitidas (pestaña en la bandeja del gestor); contadores de pendientes en el gestor del sitio. Sin cambios de backend — reutiliza los endpoints ya existentes | 12a–12c |
| **13. Pago con Stripe (modo test)** *(diferida ≈2026-09-17)* | Checkout de Stripe en **modo test** tras un feature flag (`PAYMENTS_ENABLED`); webhook de confirmación → emite la licencia y el `delivery_token` automáticamente. Se conecta cuando exista la cuenta de Stripe del proyecto padre; **nunca** claves `live` en el repo | D12, fase 12 |
| **14. Video** *(diseño en `DOCUMENTO_VIVO_ARQUITECTURA.md` §19; **COMPLETA** — §20–§23)* | Subir y publicar **video** con el mismo estándar que las fotos: validación por contenido (`ffprobe`), re-encode obligatorio a un master limpio (strip total de metadatos), marca de agua estampada por el servidor en las renditions públicas, entrega HLS adaptativa para ver + **entrega del master limpio de un solo uso** para la licencia (mismo `delivery_token`). Unifica `images`→`media` con discriminador `kind`. Sub-fases: **14a** ✅ *(2026-09-05 — §20)* refactor a `media` · **14b** ✅ *(2026-09-07 — §21)* pipeline `ffmpeg` (validación + master limpio + póster + preview 720p, transcode en segundo plano) + `<video>` en el lightbox + subida de video en el Studio · **14c** ✅ *(2026-09-07 — §22)* marca de agua sobre el póster, el preview y todas las renditions HLS + streaming adaptativo (`master.m3u8` multi-calidad servido con playlists reescritas + `hls.js` en el frontend) · **14d** ✅ *(2026-09-07 — §23)* licenciamiento de video (verificado de punta a punta: entrega del master limpio de un solo uso, con el licenciatario incrustado) + hero de portada en video (`<video>` autoplay con `prefers-reduced-motion`). **Fase 14 completa.** | D14, fases 11 y 12 |
| **15. Layout "libro"** *(diseño §24; **COMPLETA** — §25–§28)* | Nuevo layout de álbum **`book`**: un fotolibro que se hojea con el scroll (sección fija + pase de página fotorrealista con `page-flip` en modo HTML, dos imágenes por pliego, portada/contraportada). **Móvil** = una página, gesto para pasar. **`prefers-reduced-motion` / sin JS / fallo de la librería → `grid`**. Sub-fases: **15a** ✅ *(2026-09-07 — §25)* plumbing del valor `book` (6 sitios) + pliego estático de dos imágenes + cabecera slim; SSR sin JS; móvil = una hoja (CSS). El fallback a `grid` para reduced-motion entra en 15b (aún no hay animación). · **15b** ✅ *(2026-09-07 — §26)* bundlear `page-flip`, curl realista sobre los pliegos (pasar con gesto/arrastre, sin scroll todavía) · **15c** ✅ *(2026-09-07 — §27)* scroll fijo que pasa las páginas en escritorio + teclado + controles prev/next + pasada de rendimiento (`content-visibility`, precarga del pliego siguiente, higiene de `will-change`) · **15d** ✅ *(2026-09-07 — §28)* pulido (portada con la primera foto atenuada + recuento + `theme`, páginas de video = ▶ → lightbox, floritura "Fin" + CTA de contraportada, paspartú de las copias, `role="region"` + `aria-label` con la página) · **15e** ✅ *(2026-09-07 — §29)* fotolibro de portada en `/trabajo`: endpoint público `GET /showcase` (20 elementos foto+video de todas las colecciones públicas, más recientes, mezcla intercalada, nunca el original — D9, descarta video sin transcodificar) + `ShowcaseBook.tsx` (BookLayout sobre un álbum sintético + lightbox) + `<h1>` compacto conservado + `.pf-showcase` (offset del pin bajo la `.site-header` sticky) · **15f** ✅ *(2026-09-07 — §30)* arreglo del ciclado scroll↔giro (era un lazo por el `scrollTo` suave; ahora: scroll = única fuente de verdad, alineado instantáneo + ventana de silencio en los giros del usuario, nunca `flip()` mientras anima —`changeState`—, snap exacto al detenerse) + cuerpo de libro en CSS (tapas con `rotateY`, lomo, canto de páginas que crece/encoge con `--book-page`, sombra de suelo). Sigue siendo `page-flip`; el libro three.js/WebGL se deja como proyecto propio (2ª librería de UI + imágenes como texturas + sin navegador para verificar). **Fase 15 completa** (pendiente transversal: CWV y prueba visual del pase de página / del ciclado en un navegador real). | D15, fase 6 (animación) |
