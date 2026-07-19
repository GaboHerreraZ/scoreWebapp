/**
 * Payloads que Zapsign envía a los webhooks. La estructura está basada en el
 * ejemplo oficial del evento doc_signed. No hay firma HMAC, así que el payload
 * NO se usa como fuente de verdad para activar cuentas: el token identifica el
 * documento y el estado real se re-consulta a Zapsign. Los campos se dejan
 * opcionales para tolerar variaciones entre eventos.
 */

/** Un firmante dentro del payload del webhook. */
export interface ZapsignWebhookSigner {
  token?: string;
  status?: string; // 'new' | 'link-opened' | 'signed'
  name?: string;
  email?: string;
  signed_at?: string;
  sent_at?: string;
  times_viewed?: number;
  last_view_at?: string;
  auth_mode?: string;
  geo_latitude?: string;
  geo_longitude?: string;
  [key: string]: unknown;
}

/** Una variable del modelo dinámico y su valor. */
export interface ZapsignWebhookAnswer {
  variable?: string;
  value?: string;
}

/**
 * Payload del webhook doc_signed (y similares). El `token` es el del DOCUMENTO
 * (plano, a nivel raíz). `status` a nivel documento es 'signed' solo cuando
 * TODOS firmaron; si falta alguien sigue en 'pending'.
 */
export interface ZapsignWebhookPayload {
  event_type?: string; // 'doc_signed' | 'doc_created' | 'doc_refused' | 'doc_viewed' | ...
  sandbox?: boolean;
  token?: string; // token del DOCUMENTO
  external_id?: string;
  name?: string;
  status?: string; // 'signed' | 'pending' | 'recusado' — estado del documento
  rejected_reason?: string; // motivo del rechazo (evento doc_refused)
  original_file?: string;
  signed_file?: string;
  created_at?: string;
  last_update_at?: string;
  signers?: ZapsignWebhookSigner[];
  answers?: ZapsignWebhookAnswer[];
  /** Firmante que disparó este evento (quién acaba de firmar). */
  signer_who_signed?: ZapsignWebhookSigner;
  /** Firmante que disparó este evento (quién acaba de visualizar). */
  signer_who_viewed?: ZapsignWebhookSigner;
  [key: string]: unknown;
}

/**
 * Extrae el token del documento. En el payload real de Zapsign viene plano en
 * `token`; se deja el fallback a `doc.token` por compatibilidad defensiva.
 */
export function extractDocToken(
  payload: ZapsignWebhookPayload,
): string | undefined {
  return (
    payload?.token ?? (payload as { doc?: { token?: string } })?.doc?.token
  );
}
