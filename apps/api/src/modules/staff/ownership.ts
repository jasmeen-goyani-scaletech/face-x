/**
 * SQL predicates for "this user owns this registration's registrant", defined once for the modules that join a
 * registration to its person (documents, consents, readiness, registrations). Arguments are SQL fragments written by this
 * codebase (aliases and a `$n` placeholder), never user input.
 */
import { ownsPlayerSql } from '../players/ownership';

/** The staff profile belongs to this user (a coach/staff member owns only their own profile). */
export const ownsStaffProfileSql = (staffAlias: string, userParam: string): string =>
  `(${staffAlias}.user_id = ${userParam})`;

/**
 * Owner of a registration: the registrant's own account (coach/staff), or the player's family (player). Join both
 * `players` and `staff_profiles` with LEFT JOIN; exactly one is present per row (a database check guarantees it).
 * Always evaluates to true or false, never null.
 */
export const ownsRegistrantSql = (
  playerAlias: string,
  staffAlias: string,
  userParam: string,
): string =>
  `(coalesce(${ownsStaffProfileSql(staffAlias, userParam)}, false)
    or coalesce(${ownsPlayerSql(playerAlias, userParam)}, false))`;
