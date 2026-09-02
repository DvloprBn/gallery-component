import { Injectable, Logger } from '@nestjs/common';

/** Resultado de un intento de envío. */
export interface MailResult {
  delivered: boolean;
}

/**
 * Envío de correo transaccional vía Resend (API REST, sin SDK — se usa el
 * `fetch` nativo de Node).
 *
 * **Degrada con elegancia**: si `RESEND_API_KEY` es un placeholder, o Resend
 * responde con error, se registra y se devuelve `{ delivered: false }` — el
 * flujo que llamó (registro, reset de contraseña, alerta de seguridad) NUNCA
 * truena por un problema de correo.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly endpoint = 'https://api.resend.com/emails';

  /**
   * Manda un correo HTML.
   *
   * @param to - Destinatario.
   * @param subject - Asunto.
   * @param html - Cuerpo en HTML (el texto libre que se interpole ya debe
   *        venir escapado — ver `escape-html.util.ts`).
   * @returns `{ delivered: true }` solo si Resend aceptó el envío.
   */
  async send(to: string, subject: string, html: string): Promise<MailResult> {
    const apiKey = process.env.RESEND_API_KEY ?? '';
    const from = process.env.MAIL_FROM_ADDRESS ?? 'no-reply@example.com';

    if (!apiKey || apiKey.startsWith('re_placeholder')) {
      this.logger.warn(
        `RESEND_API_KEY es placeholder — correo NO enviado a ${to} ("${subject}").`,
      );
      return { delivered: false };
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to, subject, html }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.logger.error(
          `Resend respondió ${response.status} al enviar a ${to}: ${detail.slice(0, 300)}`,
        );
        return { delivered: false };
      }

      return { delivered: true };
    } catch (error) {
      this.logger.error(
        `Fallo de red al enviar correo a ${to}: ${(error as Error).message}`,
      );
      return { delivered: false };
    }
  }
}
