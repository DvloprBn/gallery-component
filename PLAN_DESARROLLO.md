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
- Modelo `albums` / `images` / `image_variants` (ver schema en `DOCUMENTO_VIVO_ARQUITECTURA.md`).
- Visibilidad por álbum: `public` / `unlisted` (por enlace) / `private`.
- **Estado de publicación por imagen**: `archivada` (subida pero fuera del portafolio) / `borrador`
  / `publicada`. La galería pública muestra solo `publicada`; el gestor ve todo. Sostiene el
  principio "mostrar menos de lo que se tiene".
- Layout por álbum: `masonry` / `justified` / `grid` / `carousel`.
- Tema por álbum: objeto de tokens de diseño (colores, tipografía, espaciado, radios) — editable
  en el Studio, **expuesto completo al crear el álbum, no "crear y luego editar"**.
- (Opcional, §4 D13) `category` por álbum: `editorial` / `comercial` / `personal` — para agrupar
  `/trabajo` cuando haya dos audiencias que se autoseleccionan.

### Capa de protección de la obra — *el fotógrafo deja de regalar sus fotos*
- **Marca de agua** aplicada por el pipeline a **todos** los derivados públicos (thumb → large).
  Configurable (§4 D9): texto por defecto de `site_settings` o PNG de logo subido; patrón diagonal
  repetido tenue u opción de esquina. El **original de resolución completa nunca se sirve en
  público** — solo derivados marcados; el archivo limpio vive tras el muro de licenciamiento y solo
  sale por URL firmada de un solo uso.
- **Metadatos de derechos embebidos** (§4 D10): se revisa la regla actual "tirar todo el EXIF" →
  seguir eliminando GPS / número de serie / datos personales, pero **incrustar IPTC/XMP**
  (`© / creator / credit / rights / licensor URL`) en cada archivo servido. Derechos legibles por
  máquina; es señal legal, **no** DRM.
- **Disuasores de copia** en el frontend: bloquear arrastre y menú contextual sobre las imágenes,
  capa transparente sobre la figura. Documentado con honestidad: son **disuasores**, no control de
  acceso — el control real es que el archivo bueno no se sirve.
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
- **Sin rail de pago en el sitio en la primera versión** (§4 D12): la transacción es
  solicitud → cotización → entrega; el pago se acuerda fuera. Stripe en **modo test tras un feature
  flag** queda como Fase 13, solo si se decide cobrar dentro.
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

### Decisiones abiertas — reencuadre a "portafolio que protege y vende" (2026-09-02)

> El dueño reencuadró el proyecto: no una galería más, sino la demo del kit real para **publicar,
> proteger y vender** obra fotográfica. Estas cinco decisiones deben cerrarse antes de arrancar la
> Fase 11. La columna "recomendación" es la propuesta del arquitecto; el dueño confirma o corrige.

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| **D9** | **Marca de agua** — ¿obligatoria en todo lo público o configurable por colección? ¿Forma (diagonal repetida / esquina / logo)? ¿Origen (texto de `site_settings` / PNG subido)? | (a) siempre, fija · (b) siempre, configurable · (c) opcional por colección | **(b)** obligatoria en público, configurable: texto de `site_settings` por defecto + opción de PNG de logo; patrón diagonal repetido tenue, con opción de esquina. Nunca desactivable para `public` (sí para entrega bajo licencia). |
| **D10** | **Metadatos** — la regla actual del pipeline es "tirar TODO el EXIF". ¿Se cambia a "tirar identificativo/ubicación, **embeber** derechos (IPTC/XMP)"? | (a) mantener: tirar todo · (b) tirar GPS/serie/personal, embeber `© / autor / crédito / licencia` | **(b)**. Práctica correcta de la industria; no reintroduce riesgo (GPS y serie siguen fuera). Actualizar `PRUEBAS_SEGURIDAD.md` F11. |
| **D11** | **Alcance de venta** — ¿solo licencia **digital** o también **impresiones**? ¿editorial + comercial o un solo tipo de uso? | (a) solo licencia digital · (b) digital + impresiones | **(a)** en la primera versión: licencia digital, con tipos de uso `editorial` / `comercial` / `social` / `impresión` (este último como "licencia para imprimir", sin inventario). Venta de impresiones físicas: fase posterior. |
| **D12** | **Rail de pago en el sitio** | (a) sin pago: solicitud → cotización → entrega, pago fuera · (b) enlace de pago externo (Stripe Payment Link / PayPal.me) · (c) checkout Stripe en **modo test** tras un feature flag | **(a)** para la primera versión (Fases 11–12). **(c)** como **Fase 13 opcional**, siempre en modo test mientras el repo sea público y la seguridad sea prioridad #1. Nunca claves `live` en el repo. |
| **D13** | **Separación comercial / editorial** en la IA (campo `category` en `albums` + `/trabajo` agrupado) | (a) no, IA plana · (b) campo `category` opcional, agrupar solo si hay >1 categoría en uso | **(b)** — añadir el campo al schema (barato), pero la IA sigue plana mientras la persona demo (documental) tenga una sola audiencia. Se activa sin migración el día que haga falta. |

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
| **10b. Curación** *(amplía la 5)* | Estado de publicación por imagen (`archivada` / `borrador` / `publicada`); vista contact-sheet en el gestor; la galería pública muestra solo la **selección publicada**; el seed pasa a curar (12–20 por colección, el resto archivado) | fase 10, D9 |
| **11. Protección de la obra** | Marca de agua en el pipeline para **todos** los derivados públicos (config. por `site_settings` / PNG de logo); original de alta resolución **fuera** del servido público; metadatos IPTC/XMP de derechos embebidos (revisa la regla "tirar todo EXIF"); disuasores de copia + aviso de copyright en el frontend | D9, D10, fases 3 y 10 |
| **12. Licenciamiento y entrega** | Modelo `license_requests` / `licenses` / `delivery_tokens`; flujo público solicitud de licencia por foto (uso + alcance); flujo del gestor cotizar → emitir licencia → **entrega del archivo limpio por URL firmada de un solo uso y caducidad**; registro de licencias; la bandeja del gestor unifica contacto + solicitudes | D11, fases 10b y 11 |
| **13. Pago en el sitio** *(opcional)* | Solo si D12 = (c): checkout Stripe en **modo test** tras un feature flag; webhooks; nunca claves `live` en el repo | D12, fase 12 |
