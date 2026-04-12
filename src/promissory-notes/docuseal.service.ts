import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocusealApi } from '@docuseal/api';

export interface DocuSealSubmitterResult {
  id: number;
  submissionId: number;
  uuid: string;
  email: string | null;
  slug: string;
  status: string;
  sentAt: string | null;
  embedSrc: string;
}

export interface CreateSubmissionParams {
  templateId: number;
  signerEmail: string;
  signerName: string;
  values: Record<string, string>;
}

export type DocuSealSubmissionStatus =
  | 'completed'
  | 'declined'
  | 'expired'
  | 'pending';

export interface DocuSealSubmissionState {
  id: number;
  status: DocuSealSubmissionStatus;
  completedAt: string | null;
}

@Injectable()
export class DocuSealService {
  private readonly logger = new Logger(DocuSealService.name);
  private readonly client: DocusealApi;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('DOCUSEAL_API_KEY') ?? '';
    const apiUrl =
      this.configService.get<string>('DOCUSEAL_API_URL') ??
      'https://api.docuseal.com';

    if (!apiKey) {
      this.logger.warn('DOCUSEAL_API_KEY is not configured');
    }

    this.client = new DocusealApi({ key: apiKey, url: apiUrl });
  }

  /**
   * Creates a submission on DocuSeal from an existing template with prefilled field values.
   * Fields are sent as `fields[]` with `readonly: true` so the signer cannot edit
   * the values we inject — they can only sign. A small allow-list of fields
   * (`currentDay`, `currentMonth`, `currentYear`) is pre-filled but left
   * editable so the signer can set the actual signature date.
   * Sends the signing request email to the signer automatically.
   */
  async createSubmission(
    params: CreateSubmissionParams,
  ): Promise<DocuSealSubmitterResult> {

    const fields = Object.entries(params.values).map(([name, value]) => ({
      name,
      default_value: value,
    }));

    try {
      const response = await this.client.createSubmission({
        template_id: params.templateId,
        send_email: true,
        submitters: [
          {
            role: 'First Party',
            email: params.signerEmail,
            name: params.signerName,
            fields,
          },
        ],
      });

      const submitter = response.submitters?.[0];
      if (!submitter) {
        throw new InternalServerErrorException(
          'DocuSeal no devolvió información del firmante.',
        );
      }

      return {
        id: submitter.id,
        submissionId: submitter.submission_id,
        uuid: submitter.uuid,
        email: submitter.email,
        slug: submitter.slug,
        status: submitter.status,
        sentAt: submitter.sent_at,
        embedSrc: submitter.embed_src,
      };
    } catch (err) {
      this.logger.error(
        `DocuSeal createSubmission failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Fetches the authoritative submission state from DocuSeal. Used by the webhook
   * handler to verify that an incoming webhook payload matches what DocuSeal
   * actually knows about the submission, so a forged webhook cannot mark a
   * promissory note as signed.
   */
  async getSubmissionState(
    submissionId: number,
  ): Promise<DocuSealSubmissionState> {
    try {
      const submission = await this.client.getSubmission(submissionId);
      return {
        id: submission.id,
        status: submission.status as DocuSealSubmissionStatus,
        completedAt:
          submission.submitters?.[0]?.completed_at ?? null,
      };
    } catch (err) {
      this.logger.error(
        `DocuSeal getSubmission failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Retrieves the list of documents (including the signed PDF URL) for a submission.
   */
  async getSignedDocumentUrl(submissionId: number): Promise<string | null> {
    try {
      const result = await this.client.getSubmissionDocuments(submissionId);
      return result.documents?.[0]?.url ?? null;
    } catch (err) {
      this.logger.error(
        `DocuSeal getSubmissionDocuments failed: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Downloads a signed PDF from the given URL and returns it as a Buffer.
   * DocuSeal signed document URLs are publicly accessible (time-limited signed URLs).
   */
  async downloadDocument(url: string): Promise<Buffer> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new InternalServerErrorException(
        `No se pudo descargar el documento firmado desde DocuSeal (HTTP ${response.status}).`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
