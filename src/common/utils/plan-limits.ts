export interface PlanLimits {
  maxUsers: number;
  maxCompanies: number;
  maxCustomers: number | null;
  maxStudiesPerMonth: number | null;
  maxAiAnalysisPerMonth: number | null;
  maxPdfExtractionsPerMonth: number | null;
}

export interface CompanySubscriptionOverrides {
  maxUsersOverride?: number | null;
  maxCustomersOverride?: number | null;
  maxStudiesPerMonthOverride?: number | null;
  maxAiAnalysisPerMonthOverride?: number | null;
  maxPdfExtractionsPerMonthOverride?: number | null;
}

export interface EffectiveLimits {
  maxUsers: number;
  maxCompanies: number;
  maxCustomers: number | null;
  maxStudiesPerMonth: number | null;
  maxAiAnalysisPerMonth: number | null;
  maxPdfExtractionsPerMonth: number | null;
}

export function getEffectiveLimits(
  override: CompanySubscriptionOverrides,
  plan: PlanLimits,
): EffectiveLimits {
  return {
    maxUsers: override.maxUsersOverride ?? plan.maxUsers,
    maxCompanies: plan.maxCompanies,
    maxCustomers:
      override.maxCustomersOverride !== undefined &&
      override.maxCustomersOverride !== null
        ? override.maxCustomersOverride
        : plan.maxCustomers,
    maxStudiesPerMonth:
      override.maxStudiesPerMonthOverride !== undefined &&
      override.maxStudiesPerMonthOverride !== null
        ? override.maxStudiesPerMonthOverride
        : plan.maxStudiesPerMonth,
    maxAiAnalysisPerMonth:
      override.maxAiAnalysisPerMonthOverride !== undefined &&
      override.maxAiAnalysisPerMonthOverride !== null
        ? override.maxAiAnalysisPerMonthOverride
        : plan.maxAiAnalysisPerMonth,
    maxPdfExtractionsPerMonth:
      override.maxPdfExtractionsPerMonthOverride !== undefined &&
      override.maxPdfExtractionsPerMonthOverride !== null
        ? override.maxPdfExtractionsPerMonthOverride
        : plan.maxPdfExtractionsPerMonth,
  };
}
