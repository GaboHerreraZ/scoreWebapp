import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SupabaseAuthGuard } from './auth/guards/supabase-auth.guard.js';
import { ParametersModule } from './parameters/parameters.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { CreditStudiesModule } from './credit-studies/credit-studies.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { UserCompaniesModule } from './user-companies/user-companies.module.js';
import { ConsultationPricesModule } from './consultation-prices/consultation-prices.module.js';
import { PackOfferingsModule } from './pack-offerings/pack-offerings.module.js';
import { AnalysisPacksModule } from './analysis-packs/analysis-packs.module.js';
import { PaymentAlertsModule } from './payment-alerts/payment-alerts.module.js';
import { PromoCodesModule } from './promo-codes/promo-codes.module.js';
import { AdminStatsModule } from './admin-stats/admin-stats.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { AiAnalysesModule } from './ai-analyses/ai-analyses.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { PromissoryNotesModule } from './promissory-notes/promissory-notes.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { EpaycoModule } from './epayco/epayco.module.js';
import { ExcelModule } from './common/excel/excel.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuthorizationModule } from './common/auth/authorization.module.js';
import { ContactRequestsModule } from './contact-requests/contact-requests.module.js';
import { SupportTicketsModule } from './support-tickets/support-tickets.module.js';
import { BlogModule } from './blog/blog.module.js';
import { DebugController } from './common/debug/debug.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SentryModule.forRoot(),
    // Rate limiting global. Default permisivo (cubre toda la API); los
    // endpoints públicos sensibles aplican un @Throttle más estricto.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ExcelModule,
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    ParametersModule,
    CompaniesModule,
    CustomersModule,
    CreditStudiesModule,
    ProfilesModule,
    UserCompaniesModule,
    ConsultationPricesModule,
    PackOfferingsModule,
    AnalysisPacksModule,
    PaymentAlertsModule,
    PromoCodesModule,
    AdminStatsModule,
    OnboardingModule,
    DashboardModule,
    AiAnalysesModule,
    InvitationsModule,
    PromissoryNotesModule,
    NotificationsModule,
    EpaycoModule,
    AdminModule,
    ContactRequestsModule,
    SupportTicketsModule,
    BlogModule,
  ],
  controllers: [DebugController],
  providers: [
    // El ThrottlerGuard va primero para que el rate-limit aplique también a
    // rutas @Public (el AuthGuard las dejaría pasar sin contar).
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
