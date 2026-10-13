import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import type { AuthContext } from '../auth/types';
import type { StaffProfileRepository } from './repository';
import type { CreateStaffProfileBody, UpdateStaffProfileBody } from './schema';
import type { StaffProfileDto } from './types';

/**
 * Coach and staff profiles: the person behind a COACH or STAFF registration (the counterpart of `players`).
 *
 * A profile belongs to one account (staff_profiles.user_id) and an account has at most one profile per type. Creating a
 * profile needs the matching role (COACH for a coach profile, STAFF for a staff profile); the role alone grants nothing
 * at an event: event access still needs an APPROVED registration (modules/events/access-service.ts). The owner can read
 * and edit; an ADMIN can read profiles that have a registration for an event of their organization; everyone else gets 404.
 */
export interface StaffProfileService {
  create(
    ctx: AuthContext,
    body: CreateStaffProfileBody,
    meta: RequestMeta,
  ): Promise<StaffProfileDto>;
  listMine(ctx: AuthContext): Promise<StaffProfileDto[]>;
  get(ctx: AuthContext, profileId: string): Promise<StaffProfileDto>;
  update(
    ctx: AuthContext,
    profileId: string,
    body: UpdateStaffProfileBody,
  ): Promise<StaffProfileDto>;
}

const notFound = () => AppError.notFound('STAFF_PROFILE_NOT_FOUND', 'Staff profile not found');

export function createStaffProfileService(repository: StaffProfileRepository): StaffProfileService {
  async function view(ctx: AuthContext, profileId: string): Promise<StaffProfileDto> {
    const found = await repository.findView(profileId, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    });
    const adminRead =
      found?.inViewerOrganization === true &&
      ctx.roles.includes('ADMIN') &&
      ctx.organizationId !== null;
    if (!found || !(found.isOwner || adminRead)) throw notFound();
    return found.profile;
  }

  return {
    async create(ctx, body, meta) {
      if (!ctx.roles.includes(body.profileType)) {
        throw AppError.forbidden('You do not have the required role', 'INSUFFICIENT_ROLE');
      }
      const id = await repository.transaction(async (r) => {
        const created = await r.insert({
          userId: ctx.userId,
          profileType: body.profileType,
          staffRole: body.staffRole ?? null,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          phone: body.phone ?? null,
        });
        if (!created) {
          throw AppError.conflict(
            'STAFF_PROFILE_ALREADY_EXISTS',
            `This account already has a ${body.profileType.toLowerCase()} profile`,
          );
        }
        await r.audit({
          action: 'STAFF_PROFILE_CREATED',
          actorUserId: ctx.userId,
          entityId: created,
          metadata: { profileType: body.profileType },
          meta,
        });
        return created;
      });
      return view(ctx, id);
    },

    listMine: (ctx) => repository.listOwned(ctx.userId),

    get: view,

    async update(ctx, profileId, body) {
      await repository.transaction(async (r) => {
        const owned = await r.lockOwned(profileId, ctx.userId);
        if (!owned) throw notFound();
        // Once a registration is submitted its data is what documents were checked against.
        if (await r.hasRegistrationPastDraft(profileId)) {
          throw AppError.conflict(
            'STAFF_PROFILE_LOCKED',
            'This profile has a submitted registration and can no longer be edited',
          );
        }
        if (body.staffRole && owned.profileType !== 'STAFF') {
          throw new AppError(422, 'VALIDATION_ERROR', 'Request validation failed', [
            { path: 'staffRole', message: 'is not allowed for a coach' },
          ]);
        }
        await r.update(profileId, body);
      });
      return view(ctx, profileId);
    },
  };
}
