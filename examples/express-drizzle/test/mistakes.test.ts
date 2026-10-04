import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkMistakes } from "../../../test/support/check-mistakes.ts";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

test("every mistake in src/mistakes.ts fails to compile, for the recorded reason", () => {
  checkMistakes({
    project: here("../"),
    file: here("../src/mistakes.ts"),
    snapshot: here("mistakes.snapshot.txt"),
  });
});
