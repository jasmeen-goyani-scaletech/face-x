import { apiRequest } from './http';
import type { ApiConsentRecord, ApiConsentStatus, ApiConsentVersion, RecordConsentInput } from './types';

/** The wording a family would accept now. Empty until the league publishes it. Readable before a registration exists. */
export const getCurrentConsents = () => apiRequest<ApiConsentVersion[]>('/consents/current', { auth: false });

export const getConsents = (registrationId: string) => apiRequest<ApiConsentStatus>(`/registrations/${registrationId}/consents`);

export const recordConsent = (registrationId: string, input: RecordConsentInput) =>
  apiRequest<ApiConsentRecord>(`/registrations/${registrationId}/consents`, { method: 'POST', body: input });
