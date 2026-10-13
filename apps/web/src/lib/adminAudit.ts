/** The activity timeline's shapes. The events themselves come from the API (see lib/admin/apiPlayerView.ts). */
export type AuditTone = 'neutral' | 'success' | 'danger';

export interface AuditEvent {
  id: string;
  at: number;
  title: string;
  detail?: string;
  /** Who did it. */
  actor: 'Registrant' | 'Admin' | 'System';
  tone: AuditTone;
}
