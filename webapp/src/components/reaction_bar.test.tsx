import { describe, expect, it } from "vitest";
import { REACTIONS } from "./reactions";
import reactionContract from "./reactions.json";

describe("REACTIONS", () => {
  it("uses the checked-in reaction contract as its picker source", () => {
    expect(REACTIONS.map(({ icon, label }) => ({ icon, label }))).toEqual(
      reactionContract,
    );
    expect(REACTIONS.every((reaction) => Boolean(reaction.Icon))).toBe(true);
  });
});
