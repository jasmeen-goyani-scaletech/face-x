import { apiRequest } from './http';
import type { ApiCheckout, ApiEvaluationResult, ApiPaymentSummary, ApiReadinessReport } from './types';

export const getPayment = (registrationId: string) => apiRequest<ApiPaymentSummary>(`/registrations/${registrationId}/payment`);

/** Starts (or retries) a Stripe checkout. The amount is decided by the server; the body is deliberately empty. */
export const startCheckout = (registrationId: string) =>
  apiRequest<ApiCheckout>(`/registrations/${registrationId}/payment`, { method: 'POST', body: {} });

export const getReadiness = (registrationId: string) => apiRequest<ApiReadinessReport>(`/registrations/${registrationId}/readiness`);

/** Asks the server to advance the registration as far as its payment, documents and consent allow. */
export const evaluateReadiness = (registrationId: string) =>
  apiRequest<ApiEvaluationResult>(`/registrations/${registrationId}/readiness/evaluate`, { method: 'POST', body: {} });
