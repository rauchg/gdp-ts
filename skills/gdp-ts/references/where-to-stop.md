# Where to stop

There is a slider between ease and rigor. You could name everything and
split every check into its smallest primitive proof. Don't. Practical
guidance:

- Name values that cross a trust boundary and are used to fetch or mutate
  something sensitive: ids from the URL or body, tokens from cookies. Don't
  name a page size.
- Split a proof when a sensitive function needs to know *which* case granted
  access, or when a primitive is reused by several policies. Otherwise one
  proof per policy is fine.
- A proof function that is a one-line query does not need its own property
  test. A proof function with a join and three conditions does.
- If the database can enforce an invariant (a check constraint that the
  deployment type and password hash are set together, say), let it, *and*
  keep the proof: the constraint stops bad rows, the proof stops bad code
  paths from being written.
- If a signature starts needing four type parameters, you have gone too far.
  Back off to a coarser proof.
