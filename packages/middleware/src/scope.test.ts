import { describe, expect, it } from "vitest";
import {
  formatScope,
  hasAllCapabilities,
  isScopeSubset,
  missingCapabilities,
  parseScope,
} from "./scope.js";

describe("parseScope", () => {
  it("splits on whitespace and drops empties", () => {
    expect([...parseScope("  notion:read   notion:write  ")]).toEqual([
      "notion:read",
      "notion:write",
    ]);
  });

  it("treats empty string as no capabilities", () => {
    expect(parseScope("").size).toBe(0);
    expect(parseScope("   ").size).toBe(0);
  });
});

describe("isScopeSubset (attenuation)", () => {
  it("allows a narrower child", () => {
    expect(isScopeSubset("notion:read", "notion:read notion:write")).toBe(true);
  });

  it("allows an identical scope", () => {
    expect(isScopeSubset("notion:read notion:write", "notion:read notion:write")).toBe(true);
  });

  it("rejects a capability the parent lacks", () => {
    expect(isScopeSubset("notion:read notion:write", "notion:read")).toBe(false);
  });

  it("treats empty child as a subset", () => {
    expect(isScopeSubset("", "notion:read")).toBe(true);
  });
});

describe("hasAllCapabilities", () => {
  it("requires every listed capability", () => {
    expect(hasAllCapabilities("notion:read notion:write", "notion:read")).toBe(true);
    expect(hasAllCapabilities("notion:read", "notion:write")).toBe(false);
    expect(hasAllCapabilities("notion:read", "notion:read notion:write")).toBe(false);
  });
});

describe("missingCapabilities / formatScope", () => {
  it("lists only the missing ones", () => {
    expect(missingCapabilities("notion:read", "notion:read notion:write")).toEqual([
      "notion:write",
    ]);
  });

  it("sorts formatted scopes", () => {
    expect(formatScope(["notion:write", "notion:read", "notion:read"])).toBe(
      "notion:read notion:write",
    );
  });
});
