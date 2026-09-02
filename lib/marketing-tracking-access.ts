export const MARKETING_TRACKING_ALLOWED_EMAIL = 'gipitorifotografias@gmail.com';

export function canAccessMarketingTracking(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === MARKETING_TRACKING_ALLOWED_EMAIL;
}
