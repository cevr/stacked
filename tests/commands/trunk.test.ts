import { describe, it, expect } from "effect-bun-test";
import { Effect } from "effect";
import { StackService } from "../../src/services/Stack.js";

describe("trunk command", () => {
  it.effect("getTrunk returns default trunk", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      const trunk = yield* stacks.getTrunk();
      expect(trunk).toBe("main");
    }).pipe(Effect.provide(StackService.layerTest())),
  );

  it.effect("setTrunk persists", () =>
    Effect.gen(function* () {
      const stacks = yield* StackService;
      yield* stacks.setTrunk("develop");
      const trunk = yield* stacks.getTrunk();
      expect(trunk).toBe("develop");
    }).pipe(Effect.provide(StackService.layerTest())),
  );
});
