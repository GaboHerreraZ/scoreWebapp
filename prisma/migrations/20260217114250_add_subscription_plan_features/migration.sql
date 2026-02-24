-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "annual_price" DOUBLE PRECISION,
ADD COLUMN     "dashboard_level" VARCHAR(20) NOT NULL DEFAULT 'basic',
ADD COLUMN     "description" VARCHAR(500),
ADD COLUMN     "email_notifications" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "max_customers" INTEGER,
ADD COLUMN     "max_studies_per_month" INTEGER,
ADD COLUMN     "monthly_price" DOUBLE PRECISION,
ADD COLUMN     "support_level" VARCHAR(30) NOT NULL DEFAULT 'email',
ADD COLUMN     "theme_customization" BOOLEAN NOT NULL DEFAULT false;
