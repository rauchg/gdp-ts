/**
 * Branded id types. Not part of gdp-ts, just good hygiene: a Host cannot be
 * passed where a ProjectId is expected. Names (from gdp-ts) go one step
 * further and distinguish *this* project id from *that* one.
 */
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, "UserId">;
export type TeamId = Brand<string, "TeamId">;
export type ProjectId = Brand<string, "ProjectId">;
/** A URL's host: a production domain or a generated deployment/preview URL. */
export type Host = Brand<string, "Host">;

export const UserId = (id: string) => id as UserId;
export const TeamId = (id: string) => id as TeamId;
export const ProjectId = (id: string) => id as ProjectId;
export const Host = (host: string) => host as Host;
