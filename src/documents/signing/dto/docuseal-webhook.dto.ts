/**
 * DocuSeal webhook payload. Only the fields we care about are typed.
 * See: https://www.docuseal.com/docs/api#webhooks
 */
export interface DocuSealWebhookPayload {
  event_type: string;
  timestamp?: string;
  data: {
    id: number;
    submission_id?: number;
    uuid?: string;
    email?: string;
    status?: string;
    completed_at?: string | null;
    declined_at?: string | null;
    submission?: {
      id: number;
      status?: string;
      completed_at?: string | null;
    };
  };
}
