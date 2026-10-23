import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type {
  KnoxConnectorHost,
  KnoxNativeRequest,
} from "../../../src/connectors/sources/knox.js";
type Dump = {
  trust: string;
  coverage: Record<string, unknown>;
  items: {
    data: Record<string, unknown>;
    evidence: { uri: string; sourceHash: string };
  }[];
};
const dirs: string[] = [];
async function load() {
  vi.resetModules();
  const dir = await mkdtemp(path.join(tmpdir(), "knox-native-"));
  dirs.push(dir);
  vi.stubEnv("OPENWIKI_CONFIG_DIR", dir);
  return import("../../../src/connectors/sources/knox.js");
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const enabled = (config: Record<string, unknown> = {}) => ({
  connectorConfig: { enabled: true, streams: ["mail"], ...config },
});
function reader(): KnoxConnectorHost {
  return {
    sourceId: "host-profile-1",
    writeEvidence: async ({ runId, stream, data }) => {
      // Isolated temporary fixture only. Production uses the host's encrypted vault.
      const { writeRawJson } = await import("../../../src/connectors/io.js");
      return writeRawJson("knox", runId, stream + ".json", data);
    },
    read: vi.fn(() =>
      Promise.resolve({
        records: [
          {
            id: "mail-1",
            sourceHash: "a".repeat(64),
            data: {
              text: "검토는 금요일",
              attachments: [{ filename: "예산.xlsx" }],
            },
          },
        ],
        coverage: { kind: "native-mail-store", complete: false },
      }),
    ),
  };
}
test("disabled collection uses no native reader, network or child process", async () => {
  const { createKnoxConnector } = await load();
  const host = reader(),
    fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const result = await createKnoxConnector(host).ingest();
  expect(result.status).toBe("skipped");
  expect(host.read).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
test.each(["baseUrl", "mcp", "headerEnv", "tokenEnv"])(
  "rejects obsolete Python server configuration: %s",
  async (field) => {
    const { createKnoxConnector } = await load();
    const host = reader();
    const result = await createKnoxConnector(host).ingest(
      enabled({ [field]: "legacy-private-value" }),
    );
    expect(result.status).toBe("error");
    expect(result.message).toContain("native Node/Electron");
    expect(host.read).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("legacy-private-value");
  },
);
test("does not silently start a server when the native host is unavailable", async () => {
  const { createKnoxConnector } = await load();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const result = await createKnoxConnector().ingest(enabled());
  expect(result.status).toBe("error");
  expect(result.message).toContain("native reader is not connected");
  expect(fetch).not.toHaveBeenCalled();
});
test("requires the host's encrypted evidence sink before reading source bodies", async () => {
  const { createKnoxConnector } = await load();
  const host = reader();
  delete host.writeEvidence;
  const result = await createKnoxConnector(host).ingest(enabled());
  expect(result.status).toBe("error");
  expect(host.read).not.toHaveBeenCalled();
  expect(result.message).toContain("encrypted evidence store");
});
test("the actual Node encrypted store supplies session evidence readable by existing OpenWiki tools", async () => {
  const { createKnoxConnector } = await load();
  const { getConnectorRawDir } =
    await import("../../../src/config/openwiki-home.js");
  const { createKnoxEvidenceStore, createKnoxNativeReader } =
    await import("../../../../nubi-desktop/runtime/knox-knowledge.mjs");
  const secrets = new Map<string, string>();
  const store = createKnoxEvidenceStore({
    rawDirectory: path.join(getConnectorRawDir("knox"), "native"),
    storeDirectory: path.join(dirs.at(-1)!, "encrypted-knox"),
    secrets: {
      get: (key: string) => Promise.resolve(secrets.get(key)),
      set: (key: string, value: string) => {
        secrets.set(key, value);
        return Promise.resolve();
      },
    },
  });
  try {
    const host = createKnoxNativeReader({
      sourceId: "native-profile",
      evidence: store,
      questions: {
        listRecorded: () =>
          Promise.resolve({ items: [{ id: "q1", runId: "r1", answer: "예" }] }),
      },
    }) as KnoxConnectorHost;
    const result = await createKnoxConnector(host).ingest(
      enabled({ streams: ["ask"] }),
    );
    expect(result.status).toBe("success");
    expect(result.rawFiles[0]).toMatch(/\.md$/u);
    const { createOpenWikiConnectorTools } =
      await import("../../../src/connectors/tools.js");
    const tool = createOpenWikiConnectorTools().find(
      (tool) => tool.name === "openwiki_read_raw_item",
    )!;
    expect(
      await tool.invoke({
        connectorId: "knox",
        path: path.relative(getConnectorRawDir("knox"), result.rawFiles[0]),
      }),
    ).toContain("historical-record-only");
    await store.dispose();
    await expect(readFile(result.rawFiles[0])).rejects.toThrow();
  } finally {
    await store.dispose();
  }
});
test("passes a narrowed scope to the native reader and preserves original hashes in immutable raw evidence", async () => {
  const { createKnoxConnector } = await load();
  const host = reader();
  const result = await createKnoxConnector(host).ingest({
    ...enabled({ streams: ["mail", "memo"], limit: 20 }),
    streams: ["mail"],
    limit: 2,
    instanceId: "work",
    windowHours: 24,
  });
  expect(host.read).toHaveBeenCalledExactlyOnceWith({
    stream: "mail",
    limit: 2,
    rooms: [],
    projects: [],
  });
  const dump = JSON.parse(await readFile(result.rawFiles[0], "utf8")) as Dump;
  expect(dump.trust).toBe("untrusted-external-data");
  expect(dump.coverage).toMatchObject({
    kind: "native-mail-store",
    windowApplied: false,
    liveCompleteness: "unknown",
    attachmentContent: "not-read",
  });
  expect(dump.items[0].evidence).toMatchObject({ sourceHash: "a".repeat(64) });
  expect(dump.items[0].evidence.uri).toMatch(/^knox-native:\/\//);
  expect(dump.items[0].data.text).toBe("검토는 금요일");
  const { createOpenWikiConnectorTools } =
    await import("../../../src/connectors/tools.js");
  const tool = createOpenWikiConnectorTools().find(
    (tool) => tool.name === "openwiki_read_raw_item",
  )!;
  expect(
    await tool.invoke({
      connectorId: "knox",
      path: `${result.runId}/mail.json`,
    }),
  ).toContain("검토는 금요일");
});
test("the registry receives the host-owned reader without a localhost transport", async () => {
  await load();
  const { createConnectorRegistry } =
    await import("../../../src/connectors/registry.js");
  const host = reader();
  const result = await createConnectorRegistry({ knox: host }).knox.ingest(
    enabled(),
  );
  expect(result.status).toBe("success");
  expect(host.read).toHaveBeenCalledOnce();
});
test("initial setup selects native mail scope without a server, token or Python command", async () => {
  await load();
  const { getStaticSourceConfig } =
    await import("../../../src/setup/credentials/steps.js");
  const config = getStaticSourceConfig("knox", "");
  expect(config).toEqual({ enabled: true, streams: ["mail"], limit: 100 });
});
test("cannot enlarge the configured streams or record limit", async () => {
  const { createKnoxConnector } = await load();
  const host = reader(),
    connector = createKnoxConnector(host);
  expect(
    (await connector.ingest({ ...enabled(), streams: ["memo"] })).status,
  ).toBe("error");
  expect(host.read).not.toHaveBeenCalled();
  await connector.ingest({ ...enabled({ limit: 2 }), limit: 500 });
  expect(host.read).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
});
test.each([[], ["mcp"], ["send"], "mail"])(
  "rejects invalid native streams: %j",
  async (streams) => {
    const { createKnoxConnector } = await load();
    const host = reader();
    expect(
      (await createKnoxConnector(host).ingest(enabled({ streams }))).status,
    ).toBe("error");
    expect(host.read).not.toHaveBeenCalled();
  },
);
test("one native source failure keeps the other evidence and never stores the native exception", async () => {
  const { createKnoxConnector } = await load();
  const host = reader();
  const read = host.read;
  host.read = vi.fn((request: KnoxNativeRequest) =>
    request.stream === "memo"
      ? Promise.reject(Error("private native path/token"))
      : read(request),
  );
  const result = await createKnoxConnector(host).ingest(
    enabled({ streams: ["mail", "memo"] }),
  );
  expect(result.status).toBe("success");
  expect(result.rawFiles).toHaveLength(1);
  expect(result.warnings).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("private native");
});
test.each(["duplicate", "oversized", "bad-hash", "wrong-project"])(
  "rejects invalid native evidence: %s",
  async (kind) => {
    const { createKnoxConnector } = await load();
    const host = reader();
    host.read = () =>
      Promise.resolve({
        coverage: {},
        records:
          kind === "duplicate"
            ? [
                { id: "x", data: {} },
                { id: "x", data: {} },
              ]
            : kind === "oversized"
              ? Array.from({ length: 101 }, (_, index) => ({
                  id: String(index),
                  data: {},
                }))
              : kind === "bad-hash"
                ? [{ id: "x", sourceHash: "wrong", data: {} }]
                : [{ id: "OTHER-1", data: { key: "OTHER-1" } }],
      });
    const result = await createKnoxConnector(host).ingest(
      enabled(
        kind === "wrong-project"
          ? { streams: ["jsm"], projects: ["WORK"] }
          : {},
      ),
    );
    expect(result.status).toBe("error");
    expect(result.rawFiles).toEqual([]);
  },
);
test("requires explicit JSM projects before reading", async () => {
  const { createKnoxConnector } = await load();
  const host = reader();
  const result = await createKnoxConnector(host).ingest(
    enabled({ streams: ["jsm"] }),
  );
  expect(result.status).toBe("error");
  expect(host.read).not.toHaveBeenCalled();
});
