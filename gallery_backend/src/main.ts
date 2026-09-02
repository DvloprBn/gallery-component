import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

/**
 * Arranca el servidor HTTP de la API.
 *
 * Configura, en este orden, las defensas transversales que TODO endpoint
 * hereda:
 *  - `helmet`: cabeceras de seguridad por defecto.
 *  - `cookie-parser`: la sesión vive en una cookie httpOnly, hay que leerla.
 *  - CORS restringido a una lista EXPLÍCITA de orígenes (nunca `*`); si la
 *    lista está vacía, se rechaza todo origen cruzado.
 *  - `ValidationPipe` con whitelist estricta: cualquier propiedad no
 *    declarada en el DTO hace fallar la petición (no se ignora en silencio).
 *  - Swagger solo fuera de producción — un mapa de la API es información
 *    sensible (OWASP API9).
 *
 * @returns Promesa que se resuelve cuando el servidor quedó escuchando.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('bootstrap');

  // Detrás del reverse proxy (Caddy) en producción: confía en la primera
  // cabecera X-Forwarded-* para que `req.ip` sea la IP real del cliente
  // (la usa la detección de fuerza bruta) y `req.protocol` sea `https`.
  if (process.env.NODE_ENV === 'production') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(cookieParser());

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // En producción la API vive bajo `/api/*` del mismo host que el frontend
  // (`galeria.dvloprbn.dev`) — un solo origen, sin CORS. En desarrollo el
  // prefijo va vacío. `GLOBAL_PREFIX` debe coincidir con la ruta que el
  // reverse proxy enruta al backend, y con la parte de ruta de `BACKEND_URL`.
  const globalPrefix = process.env.GLOBAL_PREFIX?.trim();
  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix);
  }

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Galería — API')
      .setDescription('Backend de la galería. Ver DOCUMENTO_VIVO_ARQUITECTURA.md.')
      .setVersion('0.1.0')
      .addCookieAuth('access_token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'api-json' });
  }

  // Puerto INTERNO del proceso (dentro del contenedor). El puerto del host
  // lo mapea docker-compose con BACKEND_PORT — son cosas distintas.
  const port = Number(process.env.PORT ?? 3040);
  await app.listen(port, '0.0.0.0');
  logger.log(`API escuchando en http://0.0.0.0:${port}`);
}

void bootstrap();
