import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SupabaseAuthGuard } from './auth/guards/supabase-auth.guard.js';
import { ParametersModule } from './parameters/parameters.module.js';
import { CompaniesModule } from './companies/companies.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { CreditStudiesModule } from './credit-studies/credit-studies.module.js';
import { ProfilesModule } from './profiles/profiles.module.js';
import { UserCompaniesModule } from './user-companies/user-companies.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { CompanySubscriptionsModule } from './company-subscriptions/company-subscriptions.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ParametersModule,
    CompaniesModule,
    CustomersModule,
    CreditStudiesModule,
    ProfilesModule,
    UserCompaniesModule,
    SubscriptionsModule,
    CompanySubscriptionsModule,
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
  ],
})
export class AppModule {}
