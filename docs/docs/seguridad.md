# Seguridad

> La lista replicable paso a paso está en `PRUEBAS_SEGURIDAD.md` (raíz del repo). Esto es el
> resumen de la postura.

## Transversal

- **CORS** restringido a una lista explícita (`ALLOWED_ORIGINS`), nunca `*`. En producción no hay
  peticiones cruzadas: frontend y API comparten origen bajo Caddy.
- **`helmet`** para las cabeceras de seguridad; `ValidationPipe` global con `whitelist` +
  `forbidNonWhitelisted` (una propiedad no declarada en el DTO hace fallar la petición).
- **Validación de entorno al arranque**: si falta una variable obligatoria o `TOTP_ENCRYPTION_KEY`
  está mal formada, el proceso no arranca.
- **Swagger** solo fuera de producción (un mapa de la API es información sensible).
- Postgres y Redis **sin puertos publicados** en producción; el único puerto público es el del
  reverse proxy.
- Secretos fuera de git, con entropía real, **propios de este proyecto** (un token de otro sistema
  nunca valida aquí).

## Identidad

- JWT `HS256` **fijado explícito** en firma y verificación — nunca se negocia con el cliente.
- Access token en cookie **httpOnly** (`secure` en producción, `SameSite=lax`); refresh token
  opaco de 256 bits, en la base de datos solo su `sha256`.
- Rotación del refresh con ventana de gracia (10 s); presentar un token ya usado fuera de la
  ventana ⇒ **revocación en cascada** de todas las sesiones de la cuenta.
- Fuerza bruta contada en Redis: login (10/15 min), 2FA (5/15 min), reuso de refresh. Al cruzar el
  umbral se crea una fila en `security_events` y se manda una alerta por correo.
- Secreto TOTP **cifrado** en reposo (AES-256-GCM, llave propia distinta del `JWT_SECRET`); códigos
  de recuperación **hasheados** (bcrypt), de un solo uso.
- Anti-enumeración de cuentas en `login/step1` y `forgot-password` (respuesta genérica).
- Cambio o reset de contraseña revoca todas las sesiones de refresh.

## Archivos e imágenes

- **Tipo por contenido**, no por extensión ni `Content-Type`: `sharp` decodifica la imagen real;
  si no puede, se rechaza (400). SVG **nunca** se acepta (es XML ejecutable).
- **Re-codificado obligatorio**: elimina metadatos EXIF/GPS y cualquier payload embebido.
- `limitInputPixels` contra decompression bombs; `limits.fileSize` en el interceptor (corta antes
  de bufferizar el archivo entero); rate limit de subidas por usuario.
- Media privada: solo por **URL firmada de vida corta** (HMAC del backend, o URL `authenticated`
  firmada de Cloudinary). `storage_key` = UUID aleatorio, nada derivado del cliente.
- IDOR: cada endpoint filtra por el dueño / la jerarquía, nunca solo por el `:id` de la URL;
  un recurso sin acceso responde **404**, no 403 (no confirma que existe).

## OWASP API Security Top 10

Cobertura probada con `curl` contra el backend en vivo: API1 (IDOR), API2 (autenticación),
API3 (mass assignment), API4 (consumo de recursos: fuerza bruta + límites de subida), API5
(autorización por función + jerarquía), API6 (flujos sensibles), API8 (configuración). API7/API10
no aplican todavía (no hay "importar por URL" ni OAuth). Detalle fechado en `PRUEBAS_SEGURIDAD.md`.
