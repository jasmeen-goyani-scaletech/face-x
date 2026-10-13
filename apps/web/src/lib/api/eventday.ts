import { apiRequest } from './http';
import type { ApiCheckIn, ApiFaceScan } from './types';

/**
 * Sends one photo of the person at the door to the server, which compares it with the faces enrolled for the event. The photo is the
 * whole request body (image/jpeg); the server keeps no copy. The answer is a scan: no match, a person who must be looked at by a
 * human, or a clear match. It does not check anyone in: that is a second, separate step.
 */
export const scanFace = (eventId: string, image: Blob, signal?: AbortSignal) =>
  apiRequest<ApiFaceScan>(`/events/${eventId}/face-scan`, { method: 'POST', image, signal });

/**
 * Checks in the person a scan clearly matched. The scan is the proof: the server re-checks that it is a recent match for this event
 * and operator, that it was not used before, and that the person may be checked in right now. `clientRequestId` makes a retry safe.
 */
export const checkInByFace = (
  eventId: string,
  scanId: string,
  clientRequestId: string,
  device?: { deviceId: string; deviceCheckedInAt: string }
) => apiRequest<ApiCheckIn>(`/events/${eventId}/check-ins`, { method: 'POST', body: { method: 'FACE', scanId, clientRequestId, ...device } });
