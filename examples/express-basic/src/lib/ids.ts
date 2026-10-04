/** Branded ids; the one place outside proofs/ where `as` is allowed (see eslint.config.js). */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type TeamId = Brand<string, "TeamId">;
export type ProjectId = Brand<string, "ProjectId">;

export const UserId = (id: string) => id as UserId;
export const TeamId = (id: string) => id as TeamId;
export const ProjectId = (id: string) => id as ProjectId;
