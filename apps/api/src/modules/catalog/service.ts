import { AppError } from '../../shared/errors/app-error';
import type { CatalogRepository } from './repository';
import type { ResolveInviteBody } from './schema';
import type { EventDto, TeamDto, TeamWithEventDto } from './types';

/**
 * Read-only reference data for the registration flow: which events exist, which teams they have, and what a coach
 * invite link points at. Any signed-in user may read it (it is what the pickers show); nothing here reveals an
 * invite code, an organization or another family's data. A DRAFT event is invisible (404).
 */
export interface CatalogService {
  listEvents(): Promise<EventDto[]>;
  getEvent(eventId: string): Promise<EventDto>;
  listTeams(eventId: string): Promise<TeamDto[]>;
  getTeam(teamId: string): Promise<TeamWithEventDto>;
  resolveInvite(body: ResolveInviteBody): Promise<TeamWithEventDto>;
}

const eventNotFound = () => AppError.notFound('EVENT_NOT_FOUND', 'Event not found');

export function createCatalogService(repository: CatalogRepository): CatalogService {
  return {
    listEvents: () => repository.listOpenEvents(),

    async getEvent(eventId) {
      const event = await repository.findVisibleEvent(eventId);
      if (!event) throw eventNotFound();
      return event;
    },

    async listTeams(eventId) {
      if (!(await repository.findVisibleEvent(eventId))) throw eventNotFound();
      return repository.listActiveTeams(eventId);
    },

    async getTeam(teamId) {
      const found = await repository.findVisibleTeam(teamId);
      if (!found) throw AppError.notFound('TEAM_NOT_FOUND', 'Team not found');
      return found;
    },

    async resolveInvite(body) {
      const found = await repository.findOpenTeamByInviteCode(body.inviteCode);
      // One answer for every failure (unknown code, wrong team, disabled team, event not open): a caller learns
      // nothing about which codes or teams exist.
      if (!found || (body.teamId && found.team.id !== body.teamId)) {
        throw AppError.notFound('INVITE_NOT_FOUND', 'This invite link is not valid');
      }
      return found;
    },
  };
}
