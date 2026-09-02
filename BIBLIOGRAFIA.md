# Bibliografía y Referencias de Estudio — Galería

> No es un listado al final — es la fuente **primaria** real detrás de cada decisión de
> arquitectura, para poder ir a la fuente en vez de confiar solo en la explicación de segunda
> mano. Se agrega una entrada nueva cada vez que una decisión real se apoye en algo de aquí,
> nunca todo de golpe.

## Estándares y RFCs

- **JWT — RFC 7519**: <https://datatracker.ietf.org/doc/html/rfc7519> — formato del access token.
- **TOTP — RFC 6238**: <https://datatracker.ietf.org/doc/html/rfc6238> — algoritmo del 2FA
  (el mismo de Google Authenticator / Authy).
- **HMAC — RFC 2104**: <https://datatracker.ietf.org/doc/html/rfc2104> — base de la firma de las
  URLs de acceso temporal a imágenes privadas.
- **OAuth 2.0 — RFC 6749**: <https://datatracker.ietf.org/doc/html/rfc6749> — solo relevante si
  se agrega login social en una fase posterior.

## OWASP (seguridad — la referencia detrás de `PRUEBAS_SEGURIDAD.md`)

- **OWASP API Security Project**: <https://owasp.org/www-project-api-security/> — el Top 10 que
  estructura `PRUEBAS_SEGURIDAD.md`.
- **OWASP File Upload Cheat Sheet**: <https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html>
  — validación por contenido, re-encode, nombres aleatorios, límites de tamaño.
- **OWASP SVG / XSS**: <https://cheatsheetseries.owasp.org/cheatsheets/XSS_Filter_Evasion_Cheat_Sheet.html>
  — por qué un SVG subido es XML ejecutable.
- **OWASP Authentication Cheat Sheet**: <https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html>
- **OWASP Session Management Cheat Sheet**: <https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>

## Manejo de imágenes

- **`sharp` (libvips)**: <https://sharp.pixelplumbing.com/> — re-encode, redimensionado, `limitInputPixels`,
  control de metadatos.
- **`file-type`**: <https://www.npmjs.com/package/file-type> — detección de tipo por magic bytes.
- **BlurHash**: <https://blurha.sh/> — placeholder compacto para evitar layout shift.
- **Decompression bombs (imagen)**: <https://en.wikipedia.org/wiki/Zip_bomb#Image_decompression_bombs>
  — el riesgo que cubre `limitInputPixels`.
- **Exif y privacidad (GPS en fotos)**: <https://en.wikipedia.org/wiki/Exif#Privacy_and_security>

## Frontend, rendimiento y accesibilidad

- **Next.js**: <https://nextjs.org/docs> · **`next/image`**: <https://nextjs.org/docs/app/api-reference/components/image>
- **Core Web Vitals (LCP / CLS / INP)**: <https://web.dev/articles/vitals>
- **`prefers-reduced-motion` (MDN)**: <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>
- **Content Security Policy (MDN)**: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP>
- **Cross-Origin headers (COOP/COEP/CORP)**: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cross-Origin_Resource_Policy>
  — por qué se prueban en vivo antes de activarlos (rompen CDNs de terceros sin error visible).
- **Framer Motion**: <https://www.framer.com/motion/>.
- **WCAG 2.1**: <https://www.w3.org/TR/WCAG21/>

## Documentación oficial del stack

- **NestJS — Autenticación**: <https://docs.nestjs.com/security/authentication>
- **NestJS — Rate limiting (Throttler)**: <https://docs.nestjs.com/security/rate-limiting>
- **NestJS — File upload**: <https://docs.nestjs.com/techniques/file-upload>
- **Prisma**: <https://www.prisma.io/docs>
- **Cloudinary — SDK de Node.js**: <https://cloudinary.com/documentation/node_integration> — subida
  firmada, `allowed_formats`, `type: authenticated`, URLs firmadas con expiración (D3).
- **Cloudinary — Control de acceso a recursos**: <https://cloudinary.com/documentation/control_access_to_media>
  — cómo se protege un recurso privado y se entrega solo con URL firmada de vida corta.
