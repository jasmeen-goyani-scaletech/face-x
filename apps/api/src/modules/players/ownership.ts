/**
 * SQL predicate for "this user owns this player": the player IS the user (players.user_id), or the user is
 * a linked guardian (parents.user_id through player_parents). Shared by the players and registrations
 * repositories so ownership is defined in exactly one place. Arguments are SQL fragments written by this
 * codebase (an alias and a `$n` placeholder), never user input.
 */
export const ownsPlayerSql = (playerAlias: string, userParam: string): string =>
  `(${playerAlias}.user_id = ${userParam} or exists (
      select 1 from public.player_parents pp_own
        join public.parents pa_own on pa_own.id = pp_own.parent_id
       where pp_own.player_id = ${playerAlias}.id and pa_own.user_id = ${userParam}))`;
