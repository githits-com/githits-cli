import { describe, expect, it } from "bun:test";
import { toIsoDate, toRelativeDate } from "./format-date.js";

describe("toIsoDate", () => {
  it("returns YYYY-MM-DD in UTC regardless of local timezone", () => {
    // This ISO is 2023-05-28T00:00:00Z. Even if local time is
    // 2023-05-27 late evening, the UTC slice must read 2023-05-28.
    expect(toIsoDate("2023-05-28T00:00:00Z")).toBe("2023-05-28");
  });

  it("slices off time component", () => {
    expect(toIsoDate("2024-03-12T14:30:45.123Z")).toBe("2024-03-12");
  });

  it("returns null for null / undefined / empty string", () => {
    expect(toIsoDate(null)).toBe(null);
    expect(toIsoDate(undefined)).toBe(null);
    expect(toIsoDate("")).toBe(null);
  });

  it("returns null for unparseable input", () => {
    expect(toIsoDate("not-a-date")).toBe(null);
  });

  it("is UTC-stable across a mid-day-UTC boundary (locale-safety)", () => {
    // An ISO at 23:30 UTC falls on "today" in UTC. A local-time
    // implementation would render the next day in some timezones.
    expect(toIsoDate("2024-05-10T23:30:00Z")).toBe("2024-05-10");
    // And the inverse: a 00:30 UTC falls on the stated day.
    expect(toIsoDate("2024-05-11T00:30:00Z")).toBe("2024-05-11");
  });
});

describe("toRelativeDate", () => {
  const NOW = new Date("2024-06-01T12:00:00Z");

  it("returns 'just now' within a minute", () => {
    expect(toRelativeDate("2024-06-01T11:59:30Z", NOW)).toBe("just now");
  });

  it("returns minutes / hours / days / months / years with correct pluralisation", () => {
    expect(toRelativeDate("2024-06-01T11:59:00Z", NOW)).toBe("1 minute ago");
    expect(toRelativeDate("2024-06-01T11:30:00Z", NOW)).toBe("30 minutes ago");
    expect(toRelativeDate("2024-06-01T11:00:00Z", NOW)).toBe("1 hour ago");
    expect(toRelativeDate("2024-05-31T12:00:00Z", NOW)).toBe("1 day ago");
    expect(toRelativeDate("2024-05-20T12:00:00Z", NOW)).toBe("12 days ago");
    expect(toRelativeDate("2024-04-01T12:00:00Z", NOW)).toBe("2 months ago");
    expect(toRelativeDate("2023-06-01T12:00:00Z", NOW)).toBe("1 year ago");
    expect(toRelativeDate("2020-06-01T12:00:00Z", NOW)).toBe("4 years ago");
  });

  it("returns null for null / undefined / empty / unparseable", () => {
    expect(toRelativeDate(null, NOW)).toBe(null);
    expect(toRelativeDate(undefined, NOW)).toBe(null);
    expect(toRelativeDate("", NOW)).toBe(null);
    expect(toRelativeDate("not-a-date", NOW)).toBe(null);
  });

  it("degrades to absolute ISO date for future timestamps", () => {
    expect(toRelativeDate("2025-06-01T12:00:00Z", NOW)).toBe("2025-06-01");
  });

  it("works with default clock when no `now` is passed", () => {
    // Can't pin exact output, but should produce a string or null
    // that doesn't throw.
    const result = toRelativeDate(new Date().toISOString());
    expect(typeof result === "string" || result === null).toBe(true);
  });
});
