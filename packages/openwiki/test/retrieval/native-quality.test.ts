import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { searchWiki } from "../../src/retrieval/wiki.js";

test("Markdown H1 supplies the title when frontmatter is absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openwiki-title-"));
  try {
    await mkdir(path.join(root, "openwiki"));
    for (const name of [
      "노을",
      "새벽",
      "여울",
      "해솔",
      "은하",
      "바람",
      "달빛",
      "한울",
    ])
      await writeFile(
        path.join(root, "openwiki", name + ".md"),
        `# ${name} 실행\n\n## 운영 절차\n\n사본 작성 뒤 승인하고 결과를 반영합니다.\n`,
      );
    const result = await searchWiki(root, {
      query: "달빛의 실행 전 확인부터 반영까지 순서는?",
      limit: 5,
    });
    expect("results" in result && result.results[0]?.ref[0]).toBe(
      "openwiki/달빛.md#운영-절차",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a specific heading beats repeated generic prose for a mixed-language question", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openwiki-heading-"));
  try {
    await mkdir(path.join(root, "openwiki"));
    for (let i = 0; i < 12; i++)
      await writeFile(
        path.join(root, "openwiki", `${i}.md`),
        `# 개발 가이드\n\n## 모듈${i}\n\n### 실행 위치\n\n${"입력을 확인하고 결과를 기록하는 공통 운영 문맥입니다.\n".repeat(14)}\n구현은 src/${i}/run.ts이고 검사는 tests/${i}.ts입니다.\n`,
      );
    const result = await searchWiki(root, {
      query: "모듈11 module의 run implementation과 test path를 알려주세요.",
      limit: 5,
    });
    expect("results" in result && result.results[0]?.ref[0]).toBe(
      "openwiki/11.md#모듈11",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rare authored subjects outrank unrelated pages matching more generic query words", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openwiki-subject-"));
  try {
    await mkdir(path.join(root, "openwiki"));
    await writeFile(
      path.join(root, "openwiki/policy.md"),
      "# cedarquartz policy\n\nThe approved ceiling is 42.\n",
    );
    await writeFile(
      path.join(root, "openwiki/implementation.md"),
      "# cedarquartz implementation\n\nThe current ceiling is 43.\n",
    );
    for (let i = 0; i < 10; i++)
      await writeFile(
        path.join(root, "openwiki", `${i}.md`),
        "# Other subject\n\nThe implementation source path is documented here.\n",
      );
    const result = await searchWiki(root, {
      query: "cedarquartz policy and implementation source path",
      limit: 5,
    });
    expect(
      "results" in result &&
        result.results
          .slice(0, 2)
          .map((hit) => hit.ref[0].split("#")[0])
          .sort(),
    ).toEqual(["openwiki/implementation.md", "openwiki/policy.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
