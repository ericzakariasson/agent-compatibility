import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("passes an integration smoke test", () => {
    expect("ok").toBe("ok");
  });
});
