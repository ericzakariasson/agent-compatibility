import { describe, expect, it } from "vitest";

import { LOCKFILE_BASENAMES } from "../src/config/lockfileNames.js";

describe("LOCKFILE_BASENAMES", () => {
  it("uses only non-empty lowercase basenames with no path separators", () => {
    for (const name of LOCKFILE_BASENAMES) {
      expect(name.length).toBeGreaterThan(0);
      expect(name).toBe(name.toLowerCase());
      expect(name).not.toMatch(/[/\\]/);
    }
  });

  it("includes Bun text lockfiles and prior npm/pnpm/yarn locks", () => {
    expect(LOCKFILE_BASENAMES.has("bun.lock")).toBe(true);
    expect(LOCKFILE_BASENAMES.has("bun.lockb")).toBe(true);
    expect(LOCKFILE_BASENAMES.has("package-lock.json")).toBe(true);
    expect(LOCKFILE_BASENAMES.has("pnpm-lock.yaml")).toBe(true);
    expect(LOCKFILE_BASENAMES.has("yarn.lock")).toBe(true);
  });
});
