import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  getConnectorRawDir,
  openWikiConnectorsDisplayPath,
} from "../../config/openwiki-home.js";
import {
  readConnectorConfig,
  readConnectorState,
  updateStateWithRun,
  writeConnectorState,
  createRunId,
} from "../io.js";
import type {
  ConnectorIngestOptions,
  ConnectorIngestResult,
  ConnectorRuntime,
} from "../types.js";

export type KnoxStream = "chat" | "mail" | "memo" | "jsm" | "ask";
export type KnoxNativeRecord = {
  id: string;
  data: Record<string, unknown>;
  sourceHash?: string;
};
export type KnoxNativeRequest = {
  stream: KnoxStream;
  limit: number;
  rooms: string[];
  projects: string[];
};
export type KnoxNativeCollection = {
  records: KnoxNativeRecord[];
  coverage: Record<string, unknown>;
  warnings?: string[];
};
/** Installed Node/Electron services, provided by the host. No URL, token or child process. */
export type KnoxConnectorHost = {
  sourceId: string;
  read: (request: KnoxNativeRequest) => Promise<KnoxNativeCollection>;
  writeEvidence?: (input: {
    runId: string;
    stream: KnoxStream;
    data: Record<string, unknown>;
  }) => Promise<string>;
};
type Config = Record<string, unknown> & {
  enabled?: boolean;
  streams?: unknown;
  rooms?: unknown;
  projects?: unknown;
  limit?: number;
};
const STREAMS: KnoxStream[] = ["chat", "mail", "memo", "jsm", "ask"];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

export function createKnoxConnector(
  host?: KnoxConnectorHost,
): ConnectorRuntime {
  return {
    id: "knox",
    displayName: "Knox local data",
    mode: "personal",
    backend: "native-host",
    description:
      "Uses host-owned Node/Electron mail, Windows observation and cached JSM services for wiki evidence. No Python server or app actions.",
    requiredEnv: [],
    nativeHostConnected:
      typeof host?.read === "function" &&
      typeof host.writeEvidence === "function",
    supportsAgenticDiscovery: false,
    supportsTimeWindow: false,
    ingest: (options) => ingest(options ?? {}, host),
  };
}

async function ingest(
  options: ConnectorIngestOptions,
  host?: KnoxConnectorHost,
): Promise<ConnectorIngestResult> {
  const config = {
    ...(await readConnectorConfig<Config>("knox", {
      enabled: false,
      streams: ["mail"],
      limit: 100,
    })),
    ...options.connectorConfig,
  };
  const state = await readConnectorState("knox");
  const rawFiles: string[] = [],
    warnings: string[] = [];
  const runId = `${createRunId()}-${randomUUID()}`;
  let status: ConnectorIngestResult["status"] = "skipped";
  let message = "Knox local data collection is disabled.";
  if (config.enabled === true) {
    try {
      if (
        ["baseUrl", "mcp", "headerEnv", "tokenEnv"].some(
          (key) => config[key] !== undefined,
        )
      )
        throw Error(
          "Legacy Knox Python-server settings are unsupported. Connect the native Node/Electron reader instead.",
        );
      const configured = streams(config.streams),
        selected =
          options.streams === undefined ? configured : streams(options.streams);
      if (selected.some((stream) => !configured.includes(stream)))
        throw Error(
          "Requested Knox streams exceed the configured source scope.",
        );
      if (
        !host ||
        !/^[A-Za-z0-9_-]{1,120}$/u.test(host.sourceId) ||
        typeof host.read !== "function"
      )
        throw Error(
          "Knox native reader is not connected. The host must provide its existing mail, Windows or JSM service.",
        );
      if (typeof host.writeEvidence !== "function")
        throw Error(
          "Connect the host's encrypted evidence store before collecting Knox data.",
        );
      const limit = Math.min(
        bound(config.limit),
        options.limit === undefined ? 500 : bound(options.limit),
      );
      const rooms = strings(config.rooms),
        projects = strings(config.projects);
      if (
        rooms.length > 100 ||
        projects.length > 20 ||
        projects.some((key) => !/^[A-Z][A-Z0-9]*$/u.test(key))
      )
        throw Error("Invalid Knox room or JSM project scope.");
      const scope = sha(
        JSON.stringify([host.sourceId, options.instanceId ?? "default"]),
      ).slice(0, 24);
      for (const stream of selected) {
        try {
          if (stream === "jsm" && !projects.length)
            throw Error("Select explicit JSM project keys.");
          let result: KnoxNativeCollection;
          try {
            result = await host.read({
              stream,
              limit,
              rooms: [...rooms],
              projects: [...projects],
            });
          } catch {
            throw Error(
              "The native reader could not read this source. No app action or fallback server was started.",
            );
          }
          if (
            !result ||
            !Array.isArray(result.records) ||
            result.records.length > limit ||
            !result.coverage ||
            typeof result.coverage !== "object"
          )
            throw Error("Invalid or oversized Knox native collection.");
          const unique = new Set<string>();
          const items = result.records.map((record) => {
            if (
              !record ||
              typeof record.id !== "string" ||
              !record.id ||
              record.id.length > 1000 ||
              unique.has(record.id) ||
              !record.data ||
              typeof record.data !== "object" ||
              Array.isArray(record.data) ||
              (record.sourceHash !== undefined &&
                !/^[a-f0-9]{64}$/u.test(record.sourceHash))
            )
              throw Error("Invalid or duplicate Knox native record.");
            unique.add(record.id);
            const data = JSON.parse(JSON.stringify(record.data)) as Record<
              string,
              unknown
            >;
            if (
              stream === "jsm" &&
              (typeof data.key !== "string" ||
                !/^[A-Z][A-Z0-9]*-\d+$/u.test(data.key) ||
                record.id !== data.key ||
                !projects.includes(data.key.split("-")[0]))
            )
              throw Error(
                "Knox JSM evidence is outside the configured project scope.",
              );
            if (
              stream === "chat" &&
              rooms.length &&
              (typeof data.room !== "string" || !rooms.includes(data.room))
            )
              throw Error(
                "Knox chat evidence has no matching observed room identity.",
              );
            return {
              key: record.id,
              data,
              evidence: {
                uri: `knox-native://${scope}/${stream}/${encodeURIComponent(record.id)}`,
                contentHash: sha(JSON.stringify(data)),
                sourceHash: record.sourceHash ?? null,
              },
            };
          });
          const dump = {
            source: "knox-native",
            stream,
            instanceId: options.instanceId,
            trust: "untrusted-external-data",
            collectedAt: new Date().toISOString(),
            coverage: {
              ...result.coverage,
              requestedWindowHours: options.windowHours ?? null,
              windowApplied: false,
              liveCompleteness: "unknown",
              attachmentContent: "not-read",
            },
            items,
          };
          if (Buffer.byteLength(JSON.stringify(dump)) > 8 * 1024 * 1024)
            throw Error("Knox native collection exceeds 8 MiB.");
          // Reader warnings are fixed diagnostic codes, never raw native exceptions or source text.
          warnings.push(
            ...(result.warnings ?? [])
              .filter((value) => /^[a-z][a-z0-9_]{0,99}$/u.test(value))
              .map((value) => `${stream}: ${value}`),
          );
          let saved: string;
          try {
            saved = await host.writeEvidence({ runId, stream, data: dump });
          } catch {
            throw Error("The host could not save encrypted Knox evidence.");
          }
          const relative = path.relative(getConnectorRawDir("knox"), saved);
          if (
            !relative ||
            path.isAbsolute(relative) ||
            relative.split(path.sep).includes("..")
          )
            throw Error(
              "Knox evidence is outside the configured raw session directory.",
            );
          rawFiles.push(saved);
        } catch (error) {
          warnings.push(
            `${stream}: ${error instanceof Error ? error.message : "Native collection failed."}`,
          );
        }
      }
      status = rawFiles.length ? "success" : "error";
      message = `Read ${rawFiles.length}/${selected.length} native Knox source(s). Coverage remains bounded to the returned evidence.`;
    } catch (error) {
      status = "error";
      message =
        error instanceof Error
          ? error.message
          : "Knox native collection failed.";
    }
  }
  await writeConnectorState(
    "knox",
    updateStateWithRun(state, {
      at: new Date().toISOString(),
      rawFiles,
      runId,
      status,
      warnings,
    }),
  );
  return {
    connectorId: "knox",
    message,
    rawFiles,
    runId,
    status,
    warnings,
    statePath: `${openWikiConnectorsDisplayPath}/knox/state.json`,
  };
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  )
    throw Error("Knox source scope must contain non-empty strings.");
  return [...new Set(value as string[])];
}
function streams(value: unknown): KnoxStream[] {
  const result = strings(value);
  if (
    !result.length ||
    result.some((stream) => !STREAMS.includes(stream as KnoxStream))
  )
    throw Error("Select native Knox streams from chat, mail, memo, jsm, ask.");
  return result as KnoxStream[];
}
function bound(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(500, Math.trunc(value)))
    : 100;
}
