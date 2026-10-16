import { describe, expect, test, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  reviewClaims,
  createPageReviewBudget,
  pageAssertions,
  reviewRepositoryPage,
} from "../../src/agent/repository-semantic-review.js";

const statement = "The shipping guard is unreachable.";
const source = "return Math.floor(amount * 100 / 1000) * 10;";
const claims = [
  { id: "c1", statement, evidence: [{ resource: "repo://src/price.js#L1" }] },
];
function fixture(args: object = {}, files: Record<string, string> = {}) {
  const data: Record<string, string> = {
    "/openwiki/page.md": statement,
    "/src/price.js": source,
    ...files,
  };
  const invoke = vi.fn().mockResolvedValue(
    new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "review_page",
          id: "r1",
          args: {
            checks: [
              {
                index: 0,
                verdict: "supported",
                reason: "source reasoning",
                evidence: [{ resource: "repo://src/price.js", quote: source }],
              },
            ],
            issues: [],
            ...args,
          },
        },
      ],
    }),
  );
  const bindTools = vi.fn((tools: Array<{ name: string }>) => ({
    invoke,
    tools,
  }));
  const read = vi.fn((path: string) => {
    if (!(path in data)) throw Error("missing");
    return Promise.resolve(data[path]);
  });
  return {
    data,
    invoke,
    bindTools,
    read,
    input: {
      model: { bindTools } as unknown as BaseChatModel,
      page: "/openwiki/page.md",
      claims,
      read,
    },
  };
}
describe("independent page semantic review", () => {
  test("compact support still requires a scope explanation", async () => {
    const f = fixture({
      checks: [],
      supported: [
        {
          indexes: [0],
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    });
    await expect(reviewRepositoryPage(f.input)).rejects.toThrow();
  });
  test("groups common support without dropping individual target coverage", async () => {
    const f = fixture({
      checks: [],
      supported: [
        {
          indexes: [0, 1],
          reason: "same arithmetic guard",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    });
    const result = await reviewRepositoryPage({
      ...f.input,
      claims: [
        ...claims,
        { ...claims[0], id: "c2", statement: "The code uses Math.floor." },
      ],
    });
    expect(result.accepted).toBe(true);
    f.data["/src/price.js"] = "changed";
    await expect(result.assertUnchanged()).rejects.toThrow("source_changed");
  });
  test.each([
    {
      checks: [],
      supported: [
        {
          indexes: [0, 0],
          reason: "duplicate",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    },
    {
      checks: [],
      supported: [
        {
          indexes: [1],
          reason: "out of range",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    },
    {
      supported: [
        {
          indexes: [0],
          reason: "also in checks",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    },
  ])("rejects duplicate or invalid grouped coverage", async (verdict) => {
    await expect(reviewRepositoryPage(fixture(verdict).input)).rejects.toThrow(
      "coverage_missing",
    );
  });
  test("shared support still requires authentic source quotes", async () => {
    const f = fixture({
      checks: [],
      supported: [
        {
          indexes: [0],
          reason: "unsupported quote",
          evidence: [
            { resource: "repo://src/price.js", quote: "fabricated evidence" },
          ],
        },
      ],
    });
    await expect(reviewRepositoryPage(f.input)).rejects.toThrow(
      "quote_invalid",
    );
  });
  test("a grouped success cannot hide an unsupported target", async () => {
    const f = fixture({
      supported: [
        {
          indexes: [1],
          reason: "floor",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
      checks: [
        {
          index: 0,
          verdict: "unsupported",
          reason: "overflow",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    });
    const result = await reviewRepositoryPage({
      ...f.input,
      claims: [
        ...claims,
        { ...claims[0], id: "c2", statement: "The code uses Math.floor." },
      ],
    });
    expect(result.accepted).toBe(false);
    expect(result.feedback).toContain('"claimId":"c1"');
  });
  test("requires separate coverage of risky prose even when every declared Claim was checked", async () => {
    const f = fixture(
      {},
      { "/openwiki/page.md": "# 설명\n합계가 음수일 때만 오류가 발생합니다." },
    );
    await expect(reviewRepositoryPage(f.input)).rejects.toThrow(
      "coverage_missing",
    );
  });
  test("selects actual prose, excluding frontmatter and code fences", () => {
    expect(
      pageAssertions(
        "---\ntitle: always\n---\n# always\n```js\nconst only = 1;\n```\n일반 설명. 합계가 정수일 때만 통과한다.\nThe guard is unreachable.",
      ),
    ).toEqual(["합계가 정수일 때만 통과한다.", "The guard is unreachable."]);
  });
  test("requires coverage for state-preservation claims after errors", async () => {
    const f = fixture(
      {},
      { "/openwiki/page.md": "조회가 실패하면 이전 항목은 그대로 남는다." },
    );
    await expect(reviewRepositoryPage(f.input)).rejects.toThrow(
      "coverage_missing",
    );
    expect(pageAssertions("Cache remains unchanged after failure.")).toEqual([
      "Cache remains unchanged after failure.",
    ]);
  });
  test("allows actual repair progress but bounds repeated unchanged rejections", () => {
    const budget = createPageReviewBudget();
    for (let i = 1; i <= 6; i++) {
      expect(budget.next()).toBe(i);
      budget.rejected(String(i));
    }
    expect(() => budget.next()).toThrow("attempt_limit");
    const stalled = createPageReviewBudget();
    stalled.rejected("same");
    stalled.rejected("same");
    expect(() => stalled.rejected("same")).toThrow("no_progress");
  });
  test("valid references do not accept a contradicted sentence", async () => {
    const f = fixture({
      issues: [
        {
          quote: statement,
          reason: "Finite integer input can overflow during multiplication",
          correction:
            "Qualify normal values; overflow may reach the downstream guard.",
        },
      ],
    });
    const result = await reviewRepositoryPage(f.input);
    expect(result.accepted).toBe(false);
    expect(result.feedback).toContain("overflow");
    expect(
      f.bindTools.mock.calls[0][0].map((tool: { name: string }) => tool.name),
    ).toEqual(["read_review_source", "review_page"]);
  });
  test("retains unchanged Claims and replaces/retracts only requested IDs", () => {
    expect(
      reviewClaims(
        [...claims, { ...claims[0], id: "c2" }, { ...claims[0], id: "c3" }],
        {
          claims: [{ ...claims[0], statement: "revised" }],
          retractedClaimIds: ["c2"],
        },
      ).map((c) => [c.id, c.statement]),
    ).toEqual([
      ["c3", statement],
      ["c1", "revised"],
    ]);
  });
  test("counts Claim-only corrections as progress even when the page is unchanged", async () => {
    const f = fixture(
      {},
      { "/openwiki/page.md": "A description of shipping inputs." },
    );
    const before = await reviewRepositoryPage(f.input);
    const after = await reviewRepositoryPage({
      ...f.input,
      claims: [{ ...claims[0], statement: "A qualified source claim" }],
    });
    expect(after.revision).not.toBe(before.revision);
  });
  test.each([
    { checks: [] },
    {
      checks: [
        {
          index: 2,
          verdict: "supported",
          reason: "ok",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    },
  ])("refuses incomplete claim coverage", async ({ checks }) => {
    await expect(
      reviewRepositoryPage(fixture({ checks }).input),
    ).rejects.toThrow("coverage_missing");
  });
  test("requires actual source quotations, not plausible fabricated evidence", async () => {
    const f = fixture({
      checks: [
        {
          index: 0,
          verdict: "supported",
          reason: "ok",
          evidence: [
            {
              resource: "repo://src/price.js",
              quote: "Number.isSafeInteger(amount)",
            },
          ],
        },
      ],
    });
    await expect(reviewRepositoryPage(f.input)).rejects.toThrow(
      "quote_invalid",
    );
  });
  test("repairs a Claim quotation mistaken for page prose without accepting it", async () => {
    const f = fixture();
    f.invoke.mockResolvedValueOnce(
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "review_page",
            id: "bad-quote",
            args: {
              checks: [
                {
                  index: 0,
                  verdict: "unsupported",
                  reason: "Overflow",
                  evidence: [
                    { resource: "repo://src/price.js", quote: source },
                  ],
                },
              ],
              issues: [
                {
                  quote: "Only present in a retained Claim",
                  reason: "Overflow",
                  correction: "Qualify it",
                },
              ],
            },
          },
        ],
      }),
    );
    f.invoke.mockResolvedValueOnce(
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "review_page",
            id: "fixed-quote",
            args: {
              checks: [
                {
                  index: 0,
                  verdict: "unsupported",
                  reason: "Overflow",
                  evidence: [
                    { resource: "repo://src/price.js", quote: source },
                  ],
                },
              ],
              issues: [],
            },
          },
        ],
      }),
    );
    const result = await reviewRepositoryPage(f.input);
    expect(result.accepted).toBe(false);
    expect(result.feedback).toContain("Overflow");
    expect(f.invoke).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.invoke.mock.calls[1][0])).toContain(
      "wiki_review_quote_invalid",
    );
  });
  test("uncertainty is not approval", async () => {
    const f = fixture({
      checks: [
        {
          index: 0,
          verdict: "uncertain",
          reason: "Caller missing",
          evidence: [{ resource: "repo://src/price.js", quote: source }],
        },
      ],
    });
    const review = await reviewRepositoryPage(f.input);
    expect(review.accepted).toBe(false);
    const feedback = JSON.parse(review.feedback) as { claims: unknown[] };
    expect(feedback.claims[0]).toMatchObject({
      claimId: "c1",
      statement,
      origin: "claim",
    });
  });
  test.each(["/openwiki/page.md", "/src/price.js"])(
    "rechecks reviewed bytes before commit: %s",
    async (path) => {
      const f = fixture();
      const result = await reviewRepositoryPage(f.input);
      await result.assertUnchanged();
      f.data[path] += "changed";
      await expect(result.assertUnchanged()).rejects.toThrow("changed");
    },
  );
  test("propagates cancellation without an accepted review", async () => {
    const f = fixture(),
      controller = new AbortController();
    controller.abort();
    await expect(
      reviewRepositoryPage({ ...f.input, signal: controller.signal }),
    ).rejects.toThrow();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  test("rejects evidence not present in a delivered window of a large source", async () => {
    await expect(
      reviewRepositoryPage(
        fixture({}, { "/src/price.js": "x".repeat(80_001) }).input,
      ),
    ).rejects.toThrow("quote_invalid");
  });
  test("rejects traversal before source access", async () => {
    const f = fixture();
    await expect(
      reviewRepositoryPage({
        ...f.input,
        claims: [
          { ...claims[0], evidence: [{ resource: "repo://../secret" }] },
        ],
      }),
    ).rejects.toThrow("source_invalid");
    expect(f.read).not.toHaveBeenCalledWith("/../secret");
  });
  test("additional reads are bounded and cannot finish without a verdict", async () => {
    const f = fixture();
    f.invoke.mockResolvedValue(
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "read_review_source",
            id: "read",
            args: { resource: "repo://src/price.js" },
          },
        ],
      }),
    );
    await expect(reviewRepositoryPage(f.input)).rejects.toThrow("incomplete");
    expect(f.invoke).toHaveBeenCalledTimes(12);
  });
  test("carries only admitted extra paths into repair hints and checks their contents", async () => {
    const f = fixture(
      {},
      { "/package.json": '{"scripts":{"test":"node --test"}}' },
    );
    f.invoke.mockResolvedValueOnce(
      new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "read_review_source",
            id: "extra",
            args: { resource: "repo://package.json" },
          },
        ],
      }),
    );
    const result = await reviewRepositoryPage(f.input);
    expect(result.extraSourcePaths).toEqual(["/package.json"]);
    f.data["/package.json"] = '{"scripts":{}}';
    await expect(result.assertUnchanged()).rejects.toThrow("source_changed");
  });
});


describe("large repository review", () => {
  test("reviews 60 independent sources in bounded batches without dropping a Claim", async () => {
    const f = fixture({}, {"/openwiki/page.md": "# Systems\nSixty source contracts."});
    const many = Array.from({length: 60}, (_, i) => {
      f.data[`/src/module-${i}.js`] = `export const module${i} = ${i};`;
      return {id: `claim-${i}`, statement: `Module ${i} exports its constant.`, evidence: [{resource: `repo://src/module-${i}.js`}]};
    });
    const reviewed: string[] = [];
    f.invoke.mockImplementation(async (messages) => {
      const packet = JSON.parse(messages[1].content);
      expect(packet.claims.length).toBeLessThanOrEqual(12);
      expect(JSON.stringify(packet).length).toBeLessThan(180000);
      reviewed.push(...packet.claims.map((claim: {id: string}) => claim.id));
      return new AIMessage({content: "", tool_calls: [{name:"review_page", id:"review", args:{checks:packet.claims.map((claim: {index: number; evidence: {resource: string}[]}) => ({index:claim.index,verdict:"supported",reason:"constant matches source",evidence:[{resource:claim.evidence[0].resource,quote:f.data["/"+claim.evidence[0].resource.slice(7)]}]})),issues:[]}}]});
    });
    const review = await reviewRepositoryPage({...f.input,claims:many});
    expect(review.accepted).toBe(true);
    expect(reviewed).toEqual(many.map(claim => claim.id));
    expect(f.invoke).toHaveBeenCalledTimes(5);
    f.data["/src/module-59.js"] = "changed after final batch";
    await expect(review.assertUnchanged()).rejects.toThrow("source_changed");
  });
  test("reads a large source tail on demand and validates only returned evidence", async () => {
    const prefix = "// unrelated source\n".repeat(5000);
    const f = fixture({}, {"/src/price.js":prefix + source});
    f.invoke.mockImplementationOnce(async messages => {
      const packet = JSON.parse(messages[1].content);
      expect(packet.sources[0].nextOffset).toBe(16000);
      expect(packet.sources[0].totalCharacters).toBeGreaterThan(80000);
      return new AIMessage({content:"",tool_calls:[{name:"read_review_source",id:"tail",args:{resource:"repo://src/price.js",offset:prefix.length}}]});
    });
    const review = await reviewRepositoryPage(f.input);
    expect(review.accepted).toBe(true);
    expect(f.invoke).toHaveBeenCalledTimes(2);
    const tail = JSON.parse(f.invoke.mock.calls[1][0].find((message: {tool_call_id?: string}) => message.tool_call_id === "tail").content);
    expect(tail.text).toBe(source);
    expect(tail.nextOffset).toBeNull();
    f.data["/src/price.js"] = prefix.replace("unrelated", "modified") + source;
    await expect(review.assertUnchanged()).rejects.toThrow("source_changed");
  });
  test("reviews a long page as covering windows instead of rejecting its length", async () => {
    const longPage = "Source description.\n".repeat(5000);
    const f = fixture({}, {"/openwiki/page.md":longPage});
    const result = await reviewRepositoryPage(f.input);
    expect(result.accepted).toBe(true);
    const windows = f.invoke.mock.calls.map(call => JSON.parse(call[0][1].content).page);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows.every(window => window.partial && window.text.length <= 48000)).toBe(true);
    expect(windows.map(window => window.text).join("").length).toBeGreaterThan(longPage.length);
    f.data["/openwiki/page.md"] += "changed";
    await expect(result.assertUnchanged()).rejects.toThrow("page_changed");
  });
  test("a later batch cannot hide incomplete earlier coverage", async () => {
    const f = fixture();
    await expect(reviewRepositoryPage({...f.input,claims:Array.from({length:13},(_,i)=>({...claims[0],id:String(i)}))})).rejects.toThrow("coverage_missing");
  });
});
