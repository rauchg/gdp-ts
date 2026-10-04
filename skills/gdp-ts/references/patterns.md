# Patterns

## Weakening for free

If `CanManageProtection<U, P>` is a subset of the `CanViewProtection<U, P>`
union, every manage proof *is* a view proof. No conversion function, no
second lookup:

```ts
const manage = await canManageProtection(user, project);
await disablePasswordProtection(project, manage);
return readProtection(project, manage); // also fine
```

Policies grow the same way. If Developers with an extra permission should
manage protection too, add a primitive proof and a union member; no call
site changes.

## Proofs that carry evidence

Some facts imply the existence of something else: "user U belongs to the
organization that owns P" implies an organization O. A proof can hand out O,
with a real proof about it. Haskell uses an existential type; TypeScript uses
the same callback trick as `name`:

```ts
export interface UserInProjectOrg<U, P> extends Proof<"UserInProjectOrg", [U, P]> {
  withOrg<R>(k: <O>(org: Named<O, OrgId>, owns: OrgOwnsProject<O, P>) => R): R;
}

// minting it, inside the trusted module:
return name(row.orgId, async (org) => {
  const owns = await orgOwnsProject(org, project); // a proof, not a "trust me"
  if (!owns) return null;
  const proof: UserInProjectOrg<U, P> = { ...UserInProjectOrg.prove(user, project), withOrg: (k) => k(org, owns) };
  return proof;
});

// using it: proofs make more proofs
proof.withOrg((org, owns) => billAsOrganization(project, org, owns));
```

The Password Protection examples do not need this; reach for it when a
sensitive function must act on something the check discovered. The pattern
is covered by [`test/types.ts`](https://github.com/rauchg/gdp-ts/blob/main/test/types.ts).

## Reuse, don't re-check

A proof is a value. Get it once per request and pass it to every sensitive
function that needs it. If some code only needs "is an admin", it can
`switch` on an existing `CanViewProtection` instead of hitting the database again.

## Facts that are not about authorization

The same machinery encodes any precondition: `PlanIncludesPasswordProtection<P>`
and `UrlIsPublic<H>` in the [recipe](recipe.md), `IsSorted<L>`, `KeyIn<K, M>` (a map lookup that
cannot miss), `Validated<Schema, Input>`. Authorization is just the case
where boolean blindness hurts most.
