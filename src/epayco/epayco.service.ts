import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';
import { createHash } from 'crypto';

const require = createRequire(import.meta.url);
const Epayco = require('epayco-sdk-node');

@Injectable()
export class EpaycoService {
  private readonly logger = new Logger(EpaycoService.name);
  private epayco: any;

  constructor(private readonly configService: ConfigService) {
    this.epayco = new Epayco({
      apiKey: this.configService.get<string>('EPAYCO_PUBLIC_KEY'),
      privateKey: this.configService.get<string>('EPAYCO_PRIVATE_KEY'),
      lang: 'ES',
      test: this.configService.get<string>('EPAYCO_TEST', 'true') === 'true',
    });
  }

  // ─── Token ────────────────────────────────────────────────

  async createToken(card: {
    cardNumber: string;
    expYear: string;
    expMonth: string;
    cvc: string;
    cardName: string;
  }) {
    try {
      const response = await this.epayco.token.create({
        'card[number]': card.cardNumber,
        'card[exp_year]': card.expYear,
        'card[exp_month]': card.expMonth,
        'card[cvc]': card.cvc,
        'card[name]': card.cardName,
        hasCvv: true,
      });

      if (!response?.id || !response?.status) {
        this.logger.error('ePayco token.create no retornó id', response);
        throw new Error('No se obtuvo token');
      }

      return response.id as string;
    } catch (error: any) {
      this.logger.error(`Error tokenizando tarjeta: ${error.message}`);
      throw new BadRequestException(
        'Error procesando los datos de la tarjeta. Por favor verifica la información e intenta de nuevo.',
      );
    }
  }

  // ─── Customers ────────────────────────────────────────────

  async createCustomer(params: {
    tokenCard: string;
    name: string;
    lastName: string;
    email: string;
    city: string;
    address: string;
    phone: string;
  }) {
    try {
      const response = await this.epayco.customers.create({
        token_card: params.tokenCard,
        name: params.name,
        last_name: params.lastName,
        email: params.email,
        city: params.city,
        address: params.address,
        phone: params.phone,
        cell_phone: params.phone,
        default: true,
      });

      if (!response?.data?.customerId) {
        this.logger.error(
          'ePayco customers.create no retornó customerId',
          response,
        );
        throw new Error('No se obtuvo customerId');
      }

      return response.data.customerId as string;
    } catch (error: any) {
      this.logger.error(`Error creando cliente en ePayco: ${error.message}`);
      throw new BadRequestException(
        'Error realizando la suscripción. Por favor intenta de nuevo más tarde.',
      );
    }
  }

  async addNewToken(tokenCard: string, customerId: string) {
    try {
      await this.epayco.customers.addNewToken({
        token_card: tokenCard,
        customer_id: customerId,
      });
    } catch (error: any) {
      this.logger.error(`Error actualizando token en ePayco: ${error.message}`);
      throw new BadRequestException(
        'Error procesando los datos de la tarjeta. Por favor verifica la información e intenta de nuevo.',
      );
    }
  }

  async listCustomers() {
    try {
      return await this.epayco.customers.list();
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async getDefaultTokenCard(customerId: string): Promise<string | null> {
    try {
      const response = await this.epayco.customers.get(customerId);
      const cards = response?.data?.cards ?? response?.cards ?? [];
      if (!Array.isArray(cards) || cards.length === 0) return null;

      const defaultCard =
        cards.find((c: any) => c?.default === true || c?.default === 'true') ??
        cards[0];

      const token =
        defaultCard?.token ?? defaultCard?.token_id ?? defaultCard?.id;
      return typeof token === 'string' ? token : null;
    } catch (error: any) {
      this.logger.error(
        `Error obteniendo cliente ePayco ${customerId}: ${error.message}`,
      );
      return null;
    }
  }

  async deleteCustomer(customerId: string) {
    try {
      return await this.epayco.customers.delete({ customer_id: customerId });
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  // ─── Plans ────────────────────────────────────────────────

  async listPlans() {
    try {
      return await this.epayco.plans.list();
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Crea un plan recurrente en ePayco con monto personalizado por cliente
   * (= estudios × precio consulta). Devuelve el id_plan para atar la suscripción.
   * El idPlan debe ser único: usar un identificador derivado del cliente.
   */
  async createPlan(params: {
    idPlan: string;
    name: string;
    description: string;
    amount: number;
    interval: 'month' | 'year';
    currency?: string;
  }): Promise<string> {
    try {
      const response = await this.epayco.plans.create({
        id_plan: params.idPlan,
        name: params.name,
        description: params.description,
        amount: params.amount,
        currency: params.currency ?? 'cop',
        interval: params.interval,
        interval_count: 1,
        trial_days: 0,
      });

      // ePayco devuelve el plan creado; el id es el que enviamos (id_plan).
      const createdId = response?.id_plan ?? response?.data?.id_plan;
      if (!createdId && response?.success === false) {
        this.logger.error('ePayco plans.create falló', response);
        throw new Error(response?.message ?? 'No se pudo crear el plan');
      }

      return (createdId as string) ?? params.idPlan;
    } catch (error: any) {
      this.logger.error(`Error creando plan en ePayco: ${error.message}`);
      throw new BadRequestException(
        'Error configurando el plan de pago. Por favor intenta de nuevo más tarde.',
      );
    }
  }

  // ─── Subscriptions ────────────────────────────────────────

  async createSubscription(params: {
    idPlan: string;
    customer: string;
    tokenCard: string;
    docType: string;
    docNumber: string;
    urlConfirmation: string;
  }) {
    try {
      const response = await this.epayco.subscriptions.create({
        id_plan: params.idPlan,
        customer: params.customer,
        token_card: params.tokenCard,
        doc_type: params.docType,
        doc_number: params.docNumber,
        url_confirmation: params.urlConfirmation,
        method_confirmation: 'POST',
      });

      if (!response?.id) {
        this.logger.error(
          'ePayco subscriptions.create no retornó id',
          response,
        );
        throw new Error('No se obtuvo subscription id');
      }

      return response.id as string;
    } catch (error: any) {
      this.logger.error(
        `Error creando suscripción en ePayco: ${error.message}`,
      );
      throw new BadRequestException(
        'Error realizando el pago de la suscripción. Por favor intenta de nuevo más tarde.',
      );
    }
  }

  async listSubscriptions() {
    try {
      return await this.epayco.subscriptions.list();
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  async cancelSubscription(subscriptionId: string) {
    try {
      return await this.epayco.subscriptions.cancel(subscriptionId);
    } catch (error: any) {
      throw new BadRequestException(error.message);
    }
  }

  // ─── Smart Checkout v2 (sesión de pago único) ─────────────

  private readonly APIFY_BASE = 'https://apify.epayco.co';

  /**
   * Obtiene un token de acceso a la API Apify de ePayco (Smart Checkout v2).
   * Login con Basic Auth (PUBLIC_KEY:PRIVATE_KEY) → devuelve un JWT efímero que
   * autoriza la creación de la sesión de pago.
   */
  private async getApifyToken(): Promise<string> {
    const publicKey = this.configService.get<string>('EPAYCO_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('EPAYCO_PRIVATE_KEY');
    const basic = Buffer.from(`${publicKey}:${privateKey}`).toString('base64');

    try {
      const res = await fetch(`${this.APIFY_BASE}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basic}`,
        },
      });
      const json: any = await res.json();
      if (!res.ok || !json?.token) {
        this.logger.error('ePayco login (apify) no retornó token', json);
        throw new Error('No se obtuvo token de ePayco');
      }
      return json.token as string;
    } catch (error: any) {
      this.logger.error(`Error autenticando con ePayco: ${error.message}`);
      throw new BadRequestException(
        'Error iniciando el pago. Por favor intenta de nuevo más tarde.',
      );
    }
  }

  /**
   * Crea una sesión de Smart Checkout v2 para un pago ÚNICO. Devuelve el
   * sessionId que el front pasa a ePayco.checkout.configure({ sessionId }).
   *
   * La referencia propia viaja en `invoice` y en `extras.extra1` (id del recurso
   * a confirmar), que el webhook de confirmación recibe de vuelta. El backend NO
   * procesa tarjetas: el cliente paga en el checkout de ePayco.
   */
  async createCheckoutSession(params: {
    invoice: string;
    amount: number;
    name: string;
    description: string;
    currency?: string;
    confirmationUrl: string;
    responseUrl?: string;
    extra1?: string;
    extra2?: string;
    extra3?: string;
    billing?: {
      email?: string;
      name?: string;
      address?: string;
      typeDoc?: string;
      numberDoc?: string;
      mobilePhone?: string;
    };
  }): Promise<string> {
    const token = await this.getApifyToken();

    const body: Record<string, unknown> = {
      checkout_version: '2',
      name: params.name,
      description: params.description,
      currency: (params.currency ?? 'COP').toUpperCase(),
      amount: String(params.amount),
      country: 'CO',
      lang: 'es',
      invoice: params.invoice,
      response: params.responseUrl ?? '',
      confirmation: params.confirmationUrl,
      extras: {
        extra1: params.extra1 ?? '',
        extra2: params.extra2 ?? '',
        extra3: params.extra3 ?? '',
      },
    };
    if (params.billing) body.billing = params.billing;

    try {
      const res = await fetch(`${this.APIFY_BASE}/payment/session/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json: any = await res.json();
      const sessionId = json?.data?.sessionId;
      if (!res.ok || !json?.success || !sessionId) {
        this.logger.error('ePayco session/create falló', json);
        throw new Error(json?.textResponse ?? 'No se obtuvo sessionId');
      }
      return sessionId as string;
    } catch (error: any) {
      this.logger.error(`Error creando sesión de pago ePayco: ${error.message}`);
      throw new BadRequestException(
        'Error iniciando el pago. Por favor intenta de nuevo más tarde.',
      );
    }
  }

  /**
   * Valida la firma de una confirmación de ePayco. La firma es
   * SHA256(p_cust_id ^ p_key ^ x_ref_payco ^ x_transaction_id ^ x_amount ^ x_currency_code).
   * Reutilizable por cualquier flujo que reciba confirmaciones (packs, etc.).
   */
  validateConfirmationSignature(params: {
    refPayco?: string;
    transactionId?: string;
    amount?: string;
    currencyCode?: string;
    signature?: string;
  }): boolean {
    const pCustId = this.configService.get<string>('EPAYCO_P_CUST_ID');
    const pKey = this.configService.get<string>('EPAYCO_P_KEY');

    const concatenated = `${pCustId}^${pKey}^${params.refPayco}^${params.transactionId}^${params.amount}^${params.currencyCode}`;
    const computed = createHash('sha256').update(concatenated).digest('hex');

    return computed === params.signature;
  }
}
