/* eslint @typescript-eslint/require-await: "off" -- Fetch and credential mocks intentionally resolve without I/O. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { createModel } from "../../src/agent/index.js";
import {
  createAiproFetch,
  createFabrixFetch,
} from "../../src/agent/enterprise/providers.js";
import { testFabrixConnection } from "../../src/agent/enterprise/fabrix.js";

type WireBody = {
  model: string;
  stream?: boolean;
  tools?: unknown[];
  max_tokens?: number;
  contents: string[];
  modelIds: string[];
  systemPrompt: string;
};
const requestBody = (init?: RequestInit): WireBody =>
  JSON.parse(typeof init?.body === "string" ? init.body : "") as WireBody;
type WireReply = {
  choices: { message: { tool_calls: { function: { name: string } }[] } }[];
  usage: { total_tokens: number };
};
const token = `e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString("base64url")}.test`;
const echo = {
  type: "function",
  function: {
    name: "echo",
    description: "Echo value",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};
const request = {
  model: "test-model",
  messages: [{ role: "user", content: "hello" }],
  tools: [echo],
};
const endpoint = "https://fabrix.openwiki.invalid/v1/chat/completions";
beforeEach(() => {
  vi.stubEnv("AIPRO_ACCESS_TOKEN", token);
  vi.stubEnv("AIPRO_CLI_TOKEN", "synthetic-cli-token");
  vi.stubEnv("AIPRO_CLI_BASE_URL", "https://cli.example.test/custom/v1");
  vi.stubEnv("FABRIX_BASE_URL", "https://fabrix.example.test");
  vi.stubEnv("FABRIX_CLIENT_KEY", "synthetic-client");
  vi.stubEnv("FABRIX_API_TOKEN", "synthetic-token");
  vi.stubEnv("OPENWIKI_REASONING_EFFORT", undefined);
  vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  vi.stubEnv("LANGSMITH_TRACING", "false");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function reply(
  body: Record<string, unknown>,
  content: Record<string, unknown>,
) {
  const prompt = String(body.systemPrompt);
  const nonce = /request_id "([^"]+)"/.exec(prompt)?.[1];
  return Response.json({
    status: "SUCCESS",
    content: JSON.stringify({
      protocol: "aipro-fabrix-tools-v1",
      request_id: nonce,
      ...content,
    }),
    usage: { input_tokens: 20, output_tokens: 5 },
  });
}

describe("enterprise model transports", () => {
  test("AI Pro uses the current bearer token and chat completions with tools", async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe("https://aipro.sdsdev.co.kr/api/v1/chat/completions");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${token}`,
      );
      expect(new Headers(init?.headers).has("User-Agent")).toBe(false);
      expect(requestBody(init).tools).toEqual([echo]);
      expect(requestBody(init).max_tokens).toBe(100);
      expect(init?.redirect).toBe("error");
      return Response.json({ choices: [] });
    });
    await createAiproFetch(fetchImpl)(
      "https://aipro.sdsdev.co.kr/api/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...request, max_completion_tokens: 100 }),
      },
    );
    await expect(
      createAiproFetch(fetchImpl)("https://other.example/chat/completions", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("Unsupported");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("FabriX converts headers, tool calls, results, usage and streaming", async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe("https://fabrix.example.test/openapi/chat/v1/messages");
      expect(new Headers(init?.headers).get("x-fabrix-client")).toBe(
        "synthetic-client",
      );
      expect(new Headers(init?.headers).get("x-openapi-token")).toBe(
        "Bearer synthetic-token",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      const body = requestBody(init);
      expect(body.modelIds).toEqual(["test-model"]);
      return reply(body, {
        type: "tool_calls",
        tool_calls: [{ name: "echo", arguments: { value: "ok" } }],
      });
    });
    const response = await createFabrixFetch(fetchImpl)(endpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });
    const payload = (await response.json()) as WireReply;
    expect(payload.choices[0].message.tool_calls[0].function.name).toBe("echo");
    expect(payload.usage.total_tokens).toBe(25);
    const streamed = await createFabrixFetch(fetchImpl)(endpoint, {
      method: "POST",
      body: JSON.stringify({ ...request, stream: true }),
    });
    expect(await streamed.text()).toContain("data: [DONE]");
  });

  test.each([
    { type: "tool_calls", tool_calls: [{ name: "unknown", arguments: {} }] },
    {
      type: "tool_calls",
      tool_calls: [{ name: "echo", arguments: { value: 123 } }],
    },
    {
      type: "tool_calls",
      tool_calls: [{ name: "echo", arguments: { value: "ok", extra: true } }],
    },
    { type: "message", content: "hello", request_id: "stale-nonce" },
  ])(
    "rejects invalid tool envelopes before they reach the executor: %j",
    async (content) => {
      const response = await createFabrixFetch(
        vi.fn(async (_url: unknown, init?: RequestInit) =>
          reply(requestBody(init), content),
        ),
      )(endpoint, { method: "POST", body: JSON.stringify(request) });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("fabrix_tool_protocol");
    },
  );

  test("real LangChain model bindTools executes the FabriX two-round contract", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = requestBody(init);
        if (++round === 1)
          return reply(body, {
            type: "tool_calls",
            tool_calls: [{ name: "echo", arguments: { value: "done" } }],
          });
        expect(body.contents[0]).toContain('"role":"tool"');
        expect(body.contents[0]).toContain("done");
        return reply(body, { type: "message", content: "finished" });
      }),
    );
    const model = createModel("fabrix", "test-model", 0).bindTools([echo]);
    const first = await model.invoke([new HumanMessage("Echo done")]);
    expect(first.tool_calls?.[0].args).toEqual({ value: "done" });
    const second = await model.invoke([
      new HumanMessage("Echo done"),
      first,
      new ToolMessage({
        content: "done",
        tool_call_id: first.tool_calls![0].id!,
      }),
    ]);
    expect(second.content).toBe("finished");
    expect(round).toBe(2);
  });

  test.each(["aipro", "aipro-cli"] as const)(
    "real %s model preserves model names, tool calls, results and SSE",
    async (provider) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          expect(_url).toBe(
            provider === "aipro-cli"
              ? "https://cli.example.test/custom/v1/chat/completions"
              : "https://aipro.sdsdev.co.kr/api/v1/chat/completions",
          );
          const body = requestBody(init);
          expect(body.model).toBe("GLM-5.2-NVFP4");
          const ua = new Headers(init?.headers).get("User-Agent");
          if (provider === "aipro-cli") expect(ua).toBe("AIPROCLI");
          else expect(ua).not.toBe("AIPROCLI");
          expect(body).not.toHaveProperty("systemPrompt");
          expect(body).not.toHaveProperty("contents");
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            `Bearer ${provider === "aipro-cli" ? "synthetic-cli-token" : token}`,
          );
          if (body.stream) {
            const chunk = {
              id: "synthetic",
              object: "chat.completion.chunk",
              created: 0,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "streamed" },
                  finish_reason: "stop",
                },
              ],
            };
            return new Response(
              `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            );
          }
          return Response.json({
            id: "synthetic",
            object: "chat.completion",
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_test",
                      type: "function",
                      function: { name: "echo", arguments: '{"value":"done"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          });
        }),
      );
      const model = createModel(provider, "GLM-5.2-NVFP4", 0).bindTools([echo]);
      const answer = await model.invoke([new HumanMessage("Echo done")]);
      expect(answer.tool_calls?.[0].args).toEqual({ value: "done" });
      let result = "";
      for await (const chunk of await model.stream([
        new HumanMessage("Echo done"),
        answer,
        new ToolMessage({ content: "done", tool_call_id: "call_test" }),
      ]))
        if (typeof chunk.content === "string") result += chunk.content;
      expect(result).toBe("streamed");
    },
  );

  test("connection verification needs both an echo call and its follow-up answer", async () => {
    let round = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = requestBody(init);
      const value =
        round++ === 0
          ? /value ([a-f0-9-]+)\./.exec(body.contents[0])?.[1]
          : /\\"value\\":\\"([a-f0-9-]+)\\"/.exec(body.contents[0])?.[1];
      return reply(
        body,
        round === 1
          ? {
              type: "tool_calls",
              tool_calls: [{ name: "connection_echo", arguments: { value } }],
            }
          : { type: "message", content: value },
      );
    });
    const connection = {
      endpoint: "https://fabrix.example.test",
      modelId: "test-model",
      clientKey: "test",
      token: "test",
      maxOutputTokens: 512,
    };
    expect(await testFabrixConnection(connection, { fetchImpl })).toEqual({
      response: true,
      tools: true,
      status: 200,
    });
    expect(round).toBe(2);
  });

  test("FabriX requires HTTPS, rejects images, and preserves upstream status", async () => {
    vi.stubEnv("FABRIX_BASE_URL", "http://fabrix.example.test");
    await expect(
      createFabrixFetch()(endpoint, {
        method: "POST",
        body: JSON.stringify(request),
      }),
    ).rejects.toThrow("fabrix_endpoint");
    vi.stubEnv("FABRIX_BASE_URL", "https://fabrix.example.test");
    const images = await createFabrixFetch()(endpoint, {
      method: "POST",
      body: JSON.stringify({
        ...request,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://example.test/image.png" },
              },
            ],
          },
        ],
      }),
    });
    expect(images.status).toBe(502);
    expect(await images.text()).toContain("fabrix_media_unsupported");
    const upstream = vi.fn(
      async () => new Response("secret upstream body", { status: 401 }),
    );
    const response = await createFabrixFetch(upstream)(endpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("secret upstream body");
  });
});
