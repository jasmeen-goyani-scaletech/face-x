import { AppError } from '../../shared/errors/app-error';
import type { RequestMeta } from '../../shared/http/request-meta';
import type { AuthContext } from '../auth/types';
import type { NewPlayer, PlayerRepository } from './repository';
import type { AddGuardianBody, CreatePlayerBody, UpdatePlayerBody } from './schema';
import type { PlayerDetail, PlayerDto } from './types';

/**
 * Players and their guardians.
 *
 * Ownership: a player belongs to the account that IS the player (players.user_id) or to accounts linked as a
 * guardian (parents.user_id via player_parents). Owners can read and edit. An ADMIN can read players that have a
 * registration for an event of their organization. Nobody else can see a player: they get 404, not 403, so the
 * existence of other families' records is not revealed.
 */
export interface PlayerService {
  create(ctx: AuthContext, body: CreatePlayerBody, meta: RequestMeta): Promise<PlayerDetail>;
  listMine(ctx: AuthContext): Promise<PlayerDto[]>;
  get(ctx: AuthContext, playerId: string): Promise<PlayerDetail>;
  update(ctx: AuthContext, playerId: string, body: UpdatePlayerBody): Promise<PlayerDetail>;
  addGuardian(ctx: AuthContext, playerId: string, body: AddGuardianBody): Promise<PlayerDetail>;
}

type PlayerCore = Omit<NewPlayer, 'userId'>;

const notFound = () => AppError.notFound('PLAYER_NOT_FOUND', 'Player not found');
const insufficientRole = () =>
  AppError.forbidden('You do not have the required role', 'INSUFFICIENT_ROLE');

export function createPlayerService(repository: PlayerRepository): PlayerService {
  async function view(ctx: AuthContext, playerId: string): Promise<PlayerDetail> {
    const found = await repository.findView(playerId, {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
    });
    const adminOfPlayersEvent =
      found?.inViewerOrganization === true &&
      ctx.roles.includes('ADMIN') &&
      ctx.organizationId !== null;
    if (!found || !(found.isOwner || adminOfPlayersEvent)) throw notFound();
    return found.player;
  }

  return {
    async create(ctx, body, meta) {
      const common = {
        createdBy: ctx.userId,
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: body.dateOfBirth,
        email: body.email ?? null,
        phone: body.phone ?? null,
        schoolId: body.schoolId ?? null,
        ageDivision: body.ageDivision,
      };

      const playerId = body.forSelf
        ? await createForSelf(ctx, body, common, meta)
        : await createForChild(ctx, body, common, meta);
      return view(ctx, playerId);
    },

    listMine: (ctx) => repository.listOwned(ctx.userId),

    get: view,

    async update(ctx, playerId, body) {
      await repository.transaction(async (r) => {
        if (!(await r.lockOwned(playerId, ctx.userId))) throw notFound();
        // Once a registration is submitted its data is what documents and payment were checked against.
        if (await r.hasRegistrationPastDraft(playerId)) {
          throw AppError.conflict(
            'PLAYER_LOCKED',
            'This player has a submitted registration and can no longer be edited',
          );
        }
        await r.update(playerId, body);
      });
      return view(ctx, playerId);
    },

    async addGuardian(ctx, playerId, body) {
      await repository.transaction(async (r) => {
        if (!(await r.lockOwned(playerId, ctx.userId))) throw notFound();

        let parentId: string;
        const existing = await r.findParentByEmail(body.email, ctx.userId);
        if (existing) {
          if (existing.userId !== null && existing.userId !== ctx.userId) {
            // Linking another account to this child would give that account access to it. Letting a second
            // guardian accept an invitation is a product decision that is still open.
            throw AppError.conflict(
              'PARENT_ACCOUNT_LINK_NOT_SUPPORTED',
              'This guardian already has an account and cannot be linked yet',
            );
          }
          if (existing.userId === null && !existing.linkedToCallerFamily) {
            // A record created by someone else's registration: do not attach it to this player.
            throw AppError.conflict(
              'GUARDIAN_EMAIL_CONFLICT',
              'A guardian with this email already exists',
            );
          }
          parentId = existing.id;
        } else {
          const created = await r.insertParentWithoutAccount({
            firstName: body.firstName,
            lastName: body.lastName,
            email: body.email,
            phone: body.phone ?? null,
          });
          if (!created) {
            throw AppError.conflict(
              'GUARDIAN_EMAIL_CONFLICT',
              'A guardian with this email already exists',
            );
          }
          parentId = created;
        }

        const linked = await r.linkParent({
          playerId,
          parentId,
          relationship: body.relationship,
          isPrimary: false, // the account holder who created the player stays the primary guardian
        });
        if (!linked) {
          throw AppError.conflict(
            'GUARDIAN_ALREADY_LINKED',
            'This guardian is already linked to the player',
          );
        }
      });
      return view(ctx, playerId);
    },
  };

  async function createForSelf(
    ctx: AuthContext,
    body: CreatePlayerBody,
    common: PlayerCore,
    meta: RequestMeta,
  ): Promise<string> {
    if (!ctx.roles.includes('PLAYER')) throw insufficientRole();
    if (body.guardian) {
      throw AppError.validation([
        {
          path: 'guardian',
          message: 'is not allowed when registering yourself; add guardians afterwards',
        },
      ]);
    }
    return repository.transaction(async (r) => {
      const id = await r.insertPlayer({ ...common, userId: ctx.userId });
      if (!id) throw AppError.conflict('PLAYER_ALREADY_EXISTS', 'You already have a player record');
      await r.audit({
        action: 'PLAYER_CREATED',
        actorUserId: ctx.userId,
        entityId: id,
        metadata: { forSelf: true },
        meta,
      });
      return id;
    });
  }

  async function createForChild(
    ctx: AuthContext,
    body: CreatePlayerBody,
    common: PlayerCore,
    meta: RequestMeta,
  ): Promise<string> {
    if (!ctx.roles.includes('PARENT')) throw insufficientRole();
    const guardian = body.guardian;
    if (!guardian) {
      throw AppError.validation([
        { path: 'guardian', message: 'is required when registering a child' },
      ]);
    }
    return repository.transaction(async (r) => {
      let parentId = await r.findOwnParentId(ctx.userId);
      if (!parentId) {
        if (!guardian.firstName || !guardian.lastName) {
          throw AppError.validation(
            [
              { path: 'guardian.firstName', message: 'is required the first time' },
              { path: 'guardian.lastName', message: 'is required the first time' },
            ],
            'Guardian details are required',
          );
        }
        // The guardian record carries the account's own email (unique), never an email typed in the body.
        parentId = await r.insertOwnParent({
          userId: ctx.userId,
          firstName: guardian.firstName,
          lastName: guardian.lastName,
          email: ctx.email,
          phone: guardian.phone ?? null,
        });
        // Lost a race with our own concurrent request? Then the record exists now.
        parentId ??= await r.findOwnParentId(ctx.userId);
        if (!parentId) {
          throw AppError.conflict(
            'GUARDIAN_EMAIL_CONFLICT',
            'A guardian record with your email already exists',
          );
        }
      } else if (guardian.firstName || guardian.lastName || guardian.phone) {
        // A later child: the parent may have updated their contact details on this registration, so the latest ones win.
        await r.updateOwnParent(parentId, {
          firstName: guardian.firstName,
          lastName: guardian.lastName,
          phone: guardian.phone,
        });
      }
      const id = await r.insertPlayer({ ...common, userId: null });
      if (!id) throw AppError.conflict('PLAYER_ALREADY_EXISTS', 'Player could not be created');
      await r.linkParent({
        playerId: id,
        parentId,
        relationship: guardian.relationship,
        isPrimary: true,
      });
      await r.audit({
        action: 'PLAYER_CREATED',
        actorUserId: ctx.userId,
        entityId: id,
        metadata: { forSelf: false },
        meta,
      });
      return id;
    });
  }
}
