/** Catálogo de flags válidos: un typo de code no compila. */
export const FEATURE_FLAG_CODES = ['paymentCapacity'] as const;

export type FeatureFlagCode = (typeof FEATURE_FLAG_CODES)[number];
