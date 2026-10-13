import { SetMetadata } from '@nestjs/common';

export type ProjectRole = 'ADMIN' | 'WRITE' | 'READ';

/** Role hierarchy: ADMIN > WRITE > READ. */
export const ROLE_RANK: Record<ProjectRole, number> = { READ: 1, WRITE: 2, ADMIN: 3 };

export const MIN_PROJECT_ROLE_KEY = 'minProjectRole';

/**
 * Minimum project role required for an endpoint, e.g.:
 *   @MinProjectRole('WRITE')   // READ members get 403
 *   @MinProjectRole('READ')    // any project member
 */
export const MinProjectRole = (role: ProjectRole) => SetMetadata(MIN_PROJECT_ROLE_KEY, role);
