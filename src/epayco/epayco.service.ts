import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRequire } from 'module';

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
        this.logger.error('ePayco customers.create no retornó customerId', response);
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
        this.logger.error('ePayco subscriptions.create no retornó id', response);
        throw new Error('No se obtuvo subscription id');
      }

      return response.id as string;
    } catch (error: any) {
      this.logger.error(`Error creando suscripción en ePayco: ${error.message}`);
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
}
