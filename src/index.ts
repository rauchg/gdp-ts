/**
 * gdp-ts: Ghosts of Departed Proofs for TypeScript.
 *
 * Three ideas, in order:
 *
 * 1. `name(value, k)` gives a runtime value a compile-time-only *name* `N`.
 *    The name exists only inside the callback `k`, and every call to `name`
 *    produces a different, incompatible `N`.
 *
 * 2. `defineProof("Kind")` creates a *prover*. A module that owns a prover and
 *    does not export it is a trusted module: it is the only place that can
 *    produce `Proof<"Kind", [...names]>` values. At runtime a proof is a frozen
 *    `{ kind }` object. All the work happens in the type checker.
 *
 *    Names and proofs cannot leave the `name` callback they were created in:
 *    trying to return one is a compile error, because `N` is invariant and
 *    cannot be instantiated to `unknown` on the way out.
 *
 * 3. Sensitive functions take a proof about their exact (named) arguments.
 *    `readProtection(project: Named<P, ProjectId>, proof: CanViewProtection<U, P>)`
 *    cannot be called with a proof about a different project or user, with a
 *    raw id, or with no proof at all.
 *
 * Nothing here is a theorem prover. The guarantee is practical: the honest
 * path never needs a type assertion, so forging a proof requires `as`/`any`
 * or one of a short list of equivalent constructs (`let p!:`, `declare`,
 * `null!`, module augmentation, spread-rebinding a `Named`) — all of which
 * the lint preset flags. What neither the types nor the lint can see is an
 * `any` that arrives from outside (`JSON.parse`, an untyped `req.body`):
 * keep those away from proof parameters. See the skill's limits.md.
 */

declare const NAME: unique symbol;
declare const ABOUT: unique symbol;

/**
 * A value of type `A` tagged with a compile-time-only name `N`.
 *
 * `N` is invariant (`in out`), so a `Named<never, A>` or `Named<unknown, A>`
 * cannot stand in for a `Named<N, A>`. `A` is covariant, so widening the
 * value type is fine; proofs are about the name, not the value type.
 *
 * Read the underlying value with `.value`. There is no way to construct a
 * `Named` except through {@link name} (or a type assertion).
 */
export interface Named<in out N, out A> {
  readonly value: A;
  // Phantom. `(n: N) => N` makes the *structure* invariant in N too, not just
  // the annotation: TypeScript falls back to structural comparison in some
  // places (notably discriminated-union targets), and a plain `N` slot would
  // let `never` through there. Nothing is ever assigned to this property.
  readonly [NAME]: (n: N) => N;
}

/**
 * Extracts the name from a `Named` type.
 *
 * @example
 * type P = NameOf<typeof project>; // the name of a `Named<P, ProjectId>`
 */
export type NameOf<T extends Named<any, any>> =
  T extends Named<infer N, any> ? N : never;

/**
 * Gives one, two, or three values fresh compile-time names, scoped to the
 * callback. Returns whatever the callback returns (including a Promise).
 *
 * The callback is generic in the names (`<N>(named: Named<N, A>) => R`), so
 * inside it each name is an opaque type that nothing else can produce. Two
 * calls to `name`, or two values in one call, always get incompatible names.
 *
 * @example
 * name(viewer.id, projectId, async (user, project) => {
 *   const proof = await canViewProtection(user, project);
 *   if (!proof) throw new Forbidden();
 *   return readProtection(project, proof);
 * });
 */
export function name<A, R>(a: A, k: <N>(a: Named<N, A>) => R): R;
export function name<A, B, R>(
  a: A,
  b: B,
  k: <N, M>(a: Named<N, A>, b: Named<M, B>) => R,
): R;
export function name<A, B, C, R>(
  a: A,
  b: B,
  c: C,
  k: <N, M, O>(a: Named<N, A>, b: Named<M, B>, c: Named<O, C>) => R,
): R;
export function name(...args: unknown[]): unknown {
  const k = args.pop() as (...named: unknown[]) => unknown;
  return k(...args.map((value) => Object.freeze({ value })));
}

/**
 * Evidence that some fact of kind `Kind` holds about the names in `About`.
 *
 * `About` is a tuple of names, e.g. `Proof<"UserIsProjectAdmin", [U, P]>`.
 * Both parameters are invariant, so a proof about `[unknown]` or `[never]`
 * is not accepted where a proof about `[P]` is required.
 *
 * `kind` is a real runtime field, which makes unions of proofs discriminated
 * unions you can `switch` on, and makes proofs readable in logs.
 *
 * Give each proof its own interface in its trusted module:
 *
 * @example
 * export interface UserIsProjectAdmin<U, P> extends Proof<"UserIsProjectAdmin", [U, P]> {}
 *
 * Prefer `interface ... extends` over `type ... =`: a distinct interface gives
 * TypeScript a distinct symbol per proof kind, so when a function takes a
 * union of proofs, inference never confuses one kind's names with another's.
 * (If you do use a type alias, wrap proof parameters in `NoInfer<...>`.)
 */
export interface Proof<in out Kind extends string, in out About extends readonly unknown[]> {
  readonly kind: Kind;
  // Phantom, structurally invariant for the same reason as `Named[NAME]`.
  readonly [ABOUT]: (about: About) => About;
}

/** The names of a tuple of `Named` values: `[Named<U, X>, Named<P, Y>]` -> `[U, P]`. */
export type NamesOf<S extends readonly Named<any, any>[]> = {
  -readonly [K in keyof S]: NameOf<S[K]>;
};

/**
 * Produces proofs of one kind. Create with {@link defineProof} and keep it
 * private to the module that performs the check.
 */
export interface Prover<Kind extends string> {
  readonly kind: Kind;
  /**
   * Mint a proof about the given named values. The proof's `About` tuple is
   * inferred from the arguments, so the proof is visibly about *these* values:
   *
   *     return isAdmin ? UserIsProjectAdmin.prove(user, project) : null;
   */
  prove<S extends Named<any, any>[]>(...about: S): Proof<Kind, NamesOf<S>>;
}

/**
 * Defines a kind of proof and returns the only thing that can produce it.
 *
 * Put this in a small module together with the check it stands for, and do
 * not export the prover. Export the proof type and the checking function:
 *
 * @example
 * // proofs/user-is-project-admin.ts
 * const UserIsProjectAdmin = defineProof("UserIsProjectAdmin");
 * export interface UserIsProjectAdmin<U, P> extends Proof<"UserIsProjectAdmin", [U, P]> {}
 *
 * export async function userIsProjectAdmin<U, P>(
 *   user: Named<U, UserId>,
 *   project: Named<P, ProjectId>,
 * ): Promise<UserIsProjectAdmin<U, P> | null> {
 *   const role = await db.roleInProjectTeam(user.value, project.value);
 *   return role === "owner" || role === "member" ? UserIsProjectAdmin.prove(user, project) : null;
 * }
 *
 * The runtime cost is one frozen `{ kind }` object per `defineProof` call;
 * `prove` returns that same object every time.
 */
export function defineProof<const Kind extends string>(kind: Kind): Prover<Kind> {
  const proof = Object.freeze({ kind });
  return Object.freeze({
    kind,
    // The single type assertion in this library. Everything downstream of
    // `prove` is honest, which is what lets you ban `as` in application code.
    prove: () => proof as Proof<Kind, any>,
  });
}
