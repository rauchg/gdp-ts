# What the compiler catches

From [`examples/basic/src/mistakes.ts`](https://github.com/rauchg/gdp-ts/blob/main/examples/basic/src/mistakes.ts),
plus the last line, from the library's [`test/types.ts`](https://github.com/rauchg/gdp-ts/blob/main/test/types.ts).
Each commented line is a compile error. Both files mark them with
`@ts-expect-error` and are part of the typecheck, so `pnpm check` fails if any
of them ever stops being one.

A `mistakes.ts` like this is worth keeping in your own codebase: a file that
is type-checked but never run, where each near-miss is one line under
`// @ts-expect-error`. It is the cheapest regression test for authorization.

```ts
name(viewer.id, a, b, async (user, projectA, projectB) => {
  const viewA = await canViewProtection(user, projectA);
  if (!viewA) return;

  await readProtection(projectB, viewA);   // proof is about A, not B
  await readProtection(a, viewA);          // raw id, not a named value
  await readProtection(projectA);          // no proof
  await readProtection(projectA, await canViewProtection(user, projectA)); // null not handled
  const forged: typeof viewA = { kind: "UserIsProjectAdmin" }; // cannot build a proof by hand

  // with manageA, and plan checks for A (planA) and B (planB):
  await setPasswordProtection(projectA, user, setting, { manage: viewA, plan: planA });   // viewing is not managing
  await setPasswordProtection(projectA, user, setting, { manage: manageA });              // forgot the plan check
  await setPasswordProtection(projectA, user, setting, { manage: manageA, plan: planB }); // plan checked for the wrong project
  await setPasswordProtection(projectA, user, setting, { manage: otherUsersManage, plan: planA }); // proof about someone else

  await setPasswordProtection(projectA, user, setting, { manage: manageA, plan: planA }); // ok
});

name(hostA, hostB, async (urlA, urlB) => {
  await servePage(urlB, visitA);       // a token for one URL does not unlock another
  await issueToken(urlA);              // no password check
  await issueToken(urlB, acceptedA);   // password checked for a different URL
});

const escaped = name(a, (project) => project); // names cannot leave their callback
```

Actual messages (TypeScript 7.0), in order:

```
error TS2345: Argument of type 'CanViewProtection<N, M>' is not assignable to parameter of type 'CanViewProtection<N, O>'.
error TS2345: Argument of type 'ProjectId' is not assignable to parameter of type 'Named<M, ProjectId>'.
error TS2554: Expected 2 arguments, but got 1.
error TS2345: Argument of type 'CanViewProtection<N, M> | null' is not assignable to parameter of type 'CanViewProtection<N, M>'.
error TS2322: Type '{ kind: "UserIsProjectAdmin"; }' is not assignable to type 'CanViewProtection<N, M>'.
error TS2322: Type 'CanViewProtection<N, M>' is not assignable to type 'CanManageProtection<N, M>'.
  Type 'UserHasProjectAccess<N, M>' is not assignable to type 'UserIsProjectAdmin<N, M>'.
error TS2741: Property 'plan' is missing in type '{ manage: CanManageProtection<N, M>; }' but required in type '{ manage: CanManageProtection<N, M>; plan: PlanIncludesPasswordProtection<M>; }'.
error TS2322: Type 'PlanIncludesPasswordProtection<O>' is not assignable to type 'PlanIncludesPasswordProtection<M>'.
error TS2719: Type 'CanManageProtection<N, M>' is not assignable to type 'CanManageProtection<N, M>'. Two different types with this name exist, but they are unrelated.
error TS2345: Argument of type 'CanVisitUrl<N>' is not assignable to parameter of type 'CanVisitUrl<M>'.
error TS2554: Expected 2 arguments, but got 1.
error TS2345: Argument of type 'PasswordAccepted<N>' is not assignable to parameter of type 'PasswordAccepted<M>'.
error TS2322: Type 'Named<N, ProjectId>' is not assignable to type 'Named<unknown, ProjectId>'.
```

# Reading the errors

| You see | It means |
|---|---|
| `'X<N, M>' is not assignable to '... X<N, O>'` with different letters | The proof is about a different value than the one you are passing. Check which `Named` the proof was minted for. |
| `'X<N, M>' is not assignable to 'X<N, M>'. Two different types with this name exist` | Same as above, but the names come from two different `name()` calls that both print as `N`. TypeScript shows type parameters by their declared letter, not by which call created them. |
| `'ProjectId' is not assignable to parameter of type 'Named<M, ProjectId>'` | You passed a raw id. Name it first, or pass the `Named` you already have. |
| `'X<N, M> \| null' is not assignable ...` | Handle the failed-check case before calling the sensitive function. |
| `'CanViewProtection<N, M>' is not assignable to type 'CanManageProtection<N, M>'` | You have a weaker proof than the function needs. Run the stronger check. |
| `Property 'plan' is missing ...` | A required fact was never checked. Run that check and pass its proof. |
| `Expected 2 arguments, but got 1` on a sensitive function | No proof at all. Find the check this function needs in `proofs/`. |
| `'Named<N, A>' is not assignable to type 'Named<unknown, A>'` (or `X<N>` vs `X<unknown>`) | A name is escaping its `name()` callback, typically by being returned. Move the consumer inside the callback and return plain data. |
| `Property '[ABOUT]' is missing` | Something is trying to build a proof by hand. Only the trusted module can. |
| `'Named<unknown, _>'` or `'[unknown]'` appearing in a *valid* call | You are using a `type` alias for a proof and inference picked the wrong candidate. Switch to `interface ... extends Proof<...> {}`, or wrap the parameter in `NoInfer<>`. |
