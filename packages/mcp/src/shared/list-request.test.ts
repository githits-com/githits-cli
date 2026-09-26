import { describe, expect, it } from "bun:test";
import type { ListParams } from "@githits/core-internal";
import {
  buildListParams,
  InvalidListRequestError,
  type ListRequestField,
  type ListRequestInput,
} from "./list-request.js";

function input(overrides: Partial<ListRequestInput> = {}): ListRequestInput {
  return {
    target: "npm:express@5.2.1",
    includeDetailedFields: false,
    ...overrides,
  };
}

function expectInvalid(
  field: ListRequestField,
  build: () => unknown,
): InvalidListRequestError {
  let thrown: unknown;
  try {
    build();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(InvalidListRequestError);
  const invalidError = thrown as InvalidListRequestError;
  expect(invalidError.field).toBe(field);
  expect(invalidError.message.length).toBeGreaterThan(0);
  return invalidError;
}

describe("buildListParams", () => {
  it("preserves selectors and cursors while normalizing source filters", () => {
    const result = buildListParams(
      input({
        target: "  npm:Express@5.2.1  ",
        paths: [" src/ ", "docs/**/*.md", "lib/a%2Fb.ts"],
        recursive: false,
        fileTypes: [" source ", "DOC "],
        languages: [" TypeScript ", "Rust"],
        intents: [
          " production ",
          "tEsT",
          "benchmark",
          "example",
          "generated",
          "fixture",
          "build",
          "vendor",
        ],
        limit: 500,
        after: " cursor/with=opaque ",
        waitTimeoutMs: 0,
        includeDetailedFields: true,
      }),
    );

    expect(result).toEqual({
      target: "  npm:Express@5.2.1  ",
      paths: [" src/ ", "docs/**/*.md", "lib/a%2Fb.ts"],
      recursive: false,
      fileTypes: ["source", "DOC"],
      languages: ["TypeScript", "Rust"],
      intents: [
        "PRODUCTION",
        "TEST",
        "BENCHMARK",
        "EXAMPLE",
        "GENERATED",
        "FIXTURE",
        "BUILD",
        "VENDOR",
      ],
      limit: 500,
      after: " cursor/with=opaque ",
      waitTimeoutMs: 0,
      includeDetailedFields: true,
    } satisfies ListParams);
  });

  it("omits empty arrays, blank cursors, and unspecified defaults but keeps false", () => {
    const result = buildListParams(
      input({
        target: " site:docs.example.test ",
        paths: [],
        fileTypes: [],
        languages: [],
        intents: [],
        after: " \t\n ",
        recursive: false,
      }),
    );

    expect(result).toEqual({
      target: " site:docs.example.test ",
      recursive: false,
      includeDetailedFields: false,
    });
    expect(result.limit).toBeUndefined();
    expect(result.waitTimeoutMs).toBeUndefined();
    expect(buildListParams(input({ after: "" })).after).toBeUndefined();
  });

  it("rejects missing or blank target and missing detailed-field boolean", () => {
    for (const target of ["", " \t "]) {
      expectInvalid("target", () => buildListParams(input({ target })));
    }
    expectInvalid("target", () =>
      buildListParams({
        target: undefined,
        includeDetailedFields: false,
      } as unknown as ListRequestInput),
    );
    expectInvalid("includeDetailedFields", () =>
      buildListParams({ target: "npm:express" } as ListRequestInput),
    );
  });

  it("accepts path and source-filter array maximums and rejects one over each", () => {
    const paths = Array.from({ length: 1000 }, (_, index) => `path-${index}`);
    const sourceValues = Array.from(
      { length: 64 },
      (_, index) => `type-${index}`,
    );
    const accepted = buildListParams(
      input({
        paths,
        fileTypes: sourceValues,
        languages: sourceValues,
        intents: Array.from({ length: 64 }, () => "test"),
      }),
    );
    expect(accepted.paths).toHaveLength(1000);
    expect(accepted.fileTypes).toHaveLength(64);
    expect(accepted.languages).toHaveLength(64);
    expect(accepted.intents).toHaveLength(64);

    expectInvalid("paths", () =>
      buildListParams(input({ paths: [...paths, "overflow"] })),
    );
    expectInvalid("fileTypes", () =>
      buildListParams(input({ fileTypes: [...sourceValues, "overflow"] })),
    );
    expectInvalid("languages", () =>
      buildListParams(input({ languages: [...sourceValues, "overflow"] })),
    );
    expectInvalid("intents", () =>
      buildListParams(
        input({ intents: Array.from({ length: 65 }, () => "test") }),
      ),
    );
  });

  it("enforces UTF-8 path byte bounds and preserves valid Unicode", () => {
    const exactByteLimit = "é".repeat(1024);
    const result = buildListParams(
      input({ paths: [exactByteLimit, "😀".repeat(512)] }),
    );
    expect(result.paths).toEqual([exactByteLimit, "😀".repeat(512)]);

    expectInvalid("paths", () =>
      buildListParams(input({ paths: [`${exactByteLimit}a`] })),
    );
  });

  it("rejects lone UTF-16 surrogates and accepts a complete surrogate pair", () => {
    expect(buildListParams(input({ paths: ["part-😀-end"] })).paths).toEqual([
      "part-😀-end",
    ]);
    expectInvalid("paths", () => buildListParams(input({ paths: ["\uD800"] })));
    expectInvalid("paths", () => buildListParams(input({ paths: ["\uDC00"] })));
    expectInvalid("paths", () =>
      buildListParams(input({ paths: ["before\uD800after"] })),
    );
  });

  it("rejects lone surrogates in every string field and preserves valid pairs", () => {
    const paired = "value-😀-end";
    expect(
      buildListParams(
        input({
          target: `npm:${paired}`,
          paths: [paired],
          fileTypes: [` ${paired} `],
          languages: [` ${paired} `],
          intents: [" test "],
          after: paired,
        }),
      ),
    ).toMatchObject({
      target: `npm:${paired}`,
      paths: [paired],
      fileTypes: [paired],
      languages: [paired],
      intents: ["TEST"],
      after: paired,
    });

    expectInvalid("target", () =>
      buildListParams(input({ target: "npm:\uD800" })),
    );
    expectInvalid("paths", () =>
      buildListParams(input({ paths: ["path-\uD800"] })),
    );
    expectInvalid("fileTypes", () =>
      buildListParams(input({ fileTypes: ["type-\uD800"] })),
    );
    expectInvalid("languages", () =>
      buildListParams(input({ languages: ["language-\uD800"] })),
    );
    expectInvalid("intents", () =>
      buildListParams(input({ intents: ["TEST-\uD800"] })),
    );
    expectInvalid("after", () =>
      buildListParams(input({ after: "cursor-\uD800" })),
    );
  });

  it("rejects blank paths and blank trimmed source filters", () => {
    expectInvalid("paths", () => buildListParams(input({ paths: [""] })));
    expectInvalid("paths", () => buildListParams(input({ paths: [" \t "] })));
    expectInvalid("fileTypes", () =>
      buildListParams(input({ fileTypes: ["  "] })),
    );
    expectInvalid("languages", () =>
      buildListParams(input({ languages: [""] })),
    );
    expectInvalid("intents", () =>
      buildListParams(input({ intents: [" \n"] })),
    );
  });

  it("accepts numeric boundaries and rejects values outside their ranges", () => {
    expect(buildListParams(input({ limit: 1 })).limit).toBe(1);
    expect(buildListParams(input({ limit: 500 })).limit).toBe(500);
    expect(buildListParams(input({ waitTimeoutMs: 0 })).waitTimeoutMs).toBe(0);
    expect(
      buildListParams(input({ waitTimeoutMs: 300_000 })).waitTimeoutMs,
    ).toBe(300_000);

    for (const limit of [0, 501, 1.5, Number.NaN]) {
      expectInvalid("limit", () => buildListParams(input({ limit })));
    }
    for (const waitTimeoutMs of [-1, 300_001, 0.5, Number.NaN]) {
      expectInvalid("waitTimeoutMs", () =>
        buildListParams(input({ waitTimeoutMs })),
      );
    }
  });

  it("rejects source filters for trimmed, case-sensitive site targets", () => {
    expectInvalid("fileTypes", () =>
      buildListParams(
        input({ target: "  site:docs.example.test ", fileTypes: ["md"] }),
      ),
    );
    expectInvalid("languages", () =>
      buildListParams(
        input({ target: "site:docs.example.test", languages: ["TypeScript"] }),
      ),
    );
    expectInvalid("intents", () =>
      buildListParams(
        input({ target: "site:docs.example.test", intents: ["test"] }),
      ),
    );

    expect(
      buildListParams(
        input({ target: "SITE:docs.example.test", fileTypes: [" md "] }),
      ),
    ).toMatchObject({
      target: "SITE:docs.example.test",
      fileTypes: ["md"],
    });
  });

  it("normalizes only ASCII intent case and rejects values outside the enum", () => {
    expect(buildListParams(input({ intents: [" tEsT "] })).intents).toEqual([
      "TEST",
    ]);
    expectInvalid("intents", () =>
      buildListParams(input({ intents: ["integration-test"] })),
    );
    expectInvalid("intents", () => buildListParams(input({ intents: ["ı"] })));
  });
});
