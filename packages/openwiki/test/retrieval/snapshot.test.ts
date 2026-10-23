import { expect, test } from "vitest";
import * as retrieval from "../../src/retrieval/wiki.js";

test("native snapshot search reads the exact selected section and filters assignments before limiting", async () => {
  expect(retrieval).toHaveProperty("createWikiSnapshotReader");
  const reader = await retrieval.createWikiSnapshotReader([
    {
      id: "a",
      path: "openwiki/a.md",
      text: "---\r\ntitle: Retry\r\n---\r\n# Retry\r\n\r\n## Rules\r\n\r\nTask failures retry.\r\n\r\n## Rules\r\n\r\nWait failures propagate.\r\n",
    },
    {
      id: "b",
      path: "openwiki/b.md",
      text: "# Retry\n\n## Rules\n\nTask failures retry.\n",
    },
  ]);
  try {
    const hit = reader.search("Wait failures propagate", {
      documentIds: ["a"],
      limit: 1,
    })[0];
    expect(hit.ref).toBe("openwiki/a.md#rules-1");
    const read = reader.read(hit.documentId, hit.section);
    expect(read.text).toBe("## Rules\r\n\r\nWait failures propagate.");
    expect(read.start).toBeGreaterThan(60);
    expect(
      reader.search("Task failures", { documentIds: ["b"], limit: 1 })[0]
        .documentId,
    ).toBe("b");
    expect(reader.search("anything", { documentIds: [] })).toEqual([]);
    expect(() => reader.read("other", "rules")).toThrow();
  } finally {
    reader.close();
  }
  expect(() => reader.search("retry")).toThrow();
});

test("native snapshot passage locates a late matching block without rewriting its source", async () => {
  expect(retrieval).toHaveProperty("createWikiSnapshotReader");
  const text =
    "# Retry\n\n## Rules\n\n" +
    "Unrelated introduction.\n\n".repeat(300) +
    "ERR_WAIT_LIMIT propagates unchanged.\n";
  const reader = await retrieval.createWikiSnapshotReader([
    { id: "a", path: "openwiki/a.md", text },
  ]);
  try {
    const hit = reader.search("ERR_WAIT_LIMIT")[0],
      passage = reader.passage(hit, "ERR_WAIT_LIMIT", 500);
    expect(passage.text).toContain("ERR_WAIT_LIMIT propagates unchanged.");
    expect(text.slice(passage.start, passage.end)).toBe(passage.text);
    expect(passage.text.length).toBeLessThanOrEqual(500);
  } finally {
    reader.close();
  }
});

test("a single error identifier never substitutes another error with overlapping words", async () => {
  const reader = await retrieval.createWikiSnapshotReader([
    {
      id: "a",
      path: "openwiki/a.md",
      text: "# Errors\n\nERR_AUTH_TIMEOUT needs a reset.\n",
    },
    {
      id: "b",
      path: "openwiki/b.md",
      text: "# Errors\n\nERR_AUTH_FAILED needs approval.\n",
    },
  ]);
  try {
    expect(
      reader.search("ERR_AUTH_TIMEOUT").map((hit) => hit.documentId),
    ).toEqual(["a"]);
    expect(reader.search("ERR_AUTH_UNKNOWN")).toEqual([]);
  } finally {
    reader.close();
  }
});

test("native section reads preserve table headers as separate original context", async () => {
  const text =
    "# Limits\r\n\r\n## Quotas\r\n\r\n| Name | Seconds |\r\n| --- | --- |\r\n| Renewal | 17 |\r\n";
  const reader = await retrieval.createWikiSnapshotReader([
    { id: "limits", path: "openwiki/limits.md", text },
  ]);
  try {
    const start = text.indexOf("| Renewal");
    const context = reader.context("limits", start, text.length - 2);
    expect(
      context.ranges.some(
        (range) =>
          range.kind === "table_header" &&
          text.slice(range.start, range.end).includes("Seconds"),
      ),
    ).toBe(true);
  } finally {
    reader.close();
  }
});

test("a reader that releases raw bodies rejects a same-length replacement", async () => {
  const text = "# Scope\n\nOriginal source.\n";
  const reader = await retrieval.createWikiSnapshotReader(
    [{ id: "scope", path: "openwiki/scope.md", text }],
    { retainText: false },
  );
  try {
    expect(() =>
      reader.read("scope", "scope", text.replace("Original", "Replaced")),
    ).toThrow();
    expect(reader.read("scope", "scope", text).text).toContain(
      "Original source.",
    );
  } finally {
    reader.close();
  }
});
