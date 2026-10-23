"""Run the installed official binary with current source and a loopback fake provider.
No account credentials or real model calls are used.
"""

import asyncio
import hashlib
import importlib.metadata
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Use this checkout in both this process and the isolated MCP subprocess.
source = str(Path(__file__).resolve().parents[1] / "src")
sys.path.insert(0, source)
os.environ["PYTHONPATH"] = source

import httpx

from llm_router.adapters.opencode import OpenCodeAdapter
from llm_router.errors import RouterError
from llm_router.models import ChatCompletionRequest, Profile
from llm_router.opencode_runtime import OpenCodeRuntime

requests_seen = []


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        requests_seen.append(
            {
                "path": self.path,
                "stream": body.get("stream"),
                "roles": [m.get("role") for m in body.get("messages", [])],
                "tool_count": len(body.get("tools") or []),
                "tool_choice": body.get("tool_choice"),
                "history_in_system": any(
                    m.get("role") == "system" and "AUDIT_PRIOR_USER" in str(m.get("content"))
                    for m in body.get("messages", [])
                ),
            }
        )
        tool_names = [t.get("function", {}).get("name", "") for t in body.get("tools", [])]
        selected = next((n for n in tool_names if "lookup" in n), None)
        repeat = any(
            m.get("role") == "tool" and "audit-trigger-next-step" in str(m.get("content"))
            for m in body.get("messages", [])
        )
        use_tool = selected and (
            repeat or not any(m.get("role") == "tool" for m in body.get("messages", []))
        )
        delta = (
            {
                "tool_calls": [
                    {
                        "index": 0,
                        "id": "provider_call_1",
                        "type": "function",
                        "function": {"name": selected, "arguments": '{"query":"audit"}'},
                    }
                ]
            }
            if use_tool
            else {"content": "AUDIT_OK"}
        )
        if repeat:
            delta["tool_calls"].append(
                {
                    "index": 1,
                    "id": "provider_call_2",
                    "type": "function",
                    "function": {"name": selected, "arguments": '{"query":"audit-second"}'},
                }
            )
        finish = "tool_calls" if use_tool else "stop"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for d, reason in [({"role": "assistant"}, None), (delta, None), ({}, finish)]:
            payload = {
                "id": "audit-upstream",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": "audit-model",
                "choices": [{"index": 0, "delta": d, "finish_reason": reason}],
            }
            if reason:
                payload["usage"] = {"prompt_tokens": 20, "completion_tokens": 3, "total_tokens": 23}
            self.wfile.write(("data: " + json.dumps(payload) + "\n\n").encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


async def main():
    binary = Path(
        importlib.metadata.distribution("llm-router").locate_file(
            "llm_router/_vendor/opencode/opencode"
        )
    )
    manifest = json.loads(binary.with_name("bundle.json").read_text())
    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.environ["AUDIT_LOCAL_PROVIDER_KEY"] = "audit-dummy-key"
    output = {
        "binary_version": manifest["version"],
        "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "manifest_sha256_matches": hashlib.sha256(binary.read_bytes()).hexdigest()
        == manifest["binary_sha256"],
        "real_model": False,
        "upstream": "loopback_fake_provider",
    }
    with tempfile.TemporaryDirectory(prefix="opencode-binary-audit-") as folder:
        runtime = OpenCodeRuntime(
            base_url="http://127.0.0.1:0", binary=str(binary), directory=folder, startup_timeout=30
        )
        profile = Profile(
            name="audit-local",
            provider="aipro",
            auth="api_key",
            model="audit-model",
            api_key_env="AUDIT_LOCAL_PROVIDER_KEY",
            base_url=f"http://127.0.0.1:{server.server_port}/v1",
        )
        try:
            async with httpx.AsyncClient(trust_env=False, timeout=35) as client:
                await runtime.ensure_profile(client, profile)
                health = await client.get(runtime.base_url + "/global/health")
                output["unauthenticated_health_status"] = health.status_code
                created = await client.post(
                    runtime.base_url + "/session",
                    params={"directory": folder},
                    json={"title": "Audit unauthenticated local access"},
                )
                output["unauthenticated_session_create_status"] = created.status_code
                if created.status_code == 200:
                    await client.delete(
                        runtime.base_url + "/session/" + created.json()["id"],
                        params={"directory": folder},
                    )
                adapter = OpenCodeAdapter(client, runtime)
                plain = await adapter.complete(
                    ChatCompletionRequest(
                        model=profile.name,
                        messages=[
                            {"role": "user", "content": "AUDIT_PRIOR_USER"},
                            {"role": "assistant", "content": "Prior answer"},
                            {"role": "user", "content": "Return AUDIT_OK"},
                        ],
                    ),
                    profile,
                )
                output["plain_content"] = plain["choices"][0]["message"]["content"]
                tool_request = ChatCompletionRequest(
                    model=profile.name,
                    messages=[{"role": "user", "content": "Call lookup for audit."}],
                    tools=[
                        {
                            "type": "function",
                            "function": {
                                "name": "lookup",
                                "description": "Audit lookup",
                                "parameters": {
                                    "type": "object",
                                    "properties": {"query": {"type": "string"}},
                                    "required": ["query"],
                                },
                            },
                        }
                    ],
                )
                called = await adapter.complete(tool_request, profile)
                output["tool_finish_reason"] = called["choices"][0]["finish_reason"]
                calls = called["choices"][0]["message"].get("tool_calls", [])
                output["caller_tool_names"] = [c["function"]["name"] for c in calls]
                if calls:
                    resumed = await adapter.complete(
                        ChatCompletionRequest(
                            model=profile.name,
                            tools=tool_request.tools,
                            messages=[
                                *tool_request.messages,
                                called["choices"][0]["message"],
                                *[
                                    {
                                        "role": "tool",
                                        "tool_call_id": c["id"],
                                        "content": "lookup succeeded",
                                    }
                                    for c in calls
                                ],
                            ],
                        ),
                        profile,
                    )
                    output["resumed_content"] = resumed["choices"][0]["message"]["content"]
                output["mcp_entries_after_cleanup"] = len(
                    (
                        await client.get(
                            runtime.base_url + "/mcp",
                            params={"directory": folder},
                            auth=runtime.auth,
                        )
                    ).json()
                )
                called_again = await adapter.complete(tool_request, profile)
                pending_calls = called_again["choices"][0]["message"]["tool_calls"]
                try:
                    await adapter.complete(
                        ChatCompletionRequest(
                            model=profile.name,
                            tools=tool_request.tools,
                            tool_choice="none",
                            parallel_tool_calls=False,
                            messages=[
                                *tool_request.messages,
                                called_again["choices"][0]["message"],
                                *[
                                    {
                                        "role": "tool",
                                        "tool_call_id": c["id"],
                                        "content": "audit-trigger-next-step",
                                    }
                                    for c in pending_calls
                                ],
                            ],
                        ),
                        profile,
                    )
                    output["changed_contract_rejected"] = False
                except RouterError as error:
                    output["changed_contract_rejected"] = (
                        error.code == "opencode_tool_contract_changed"
                    )
                    context = next(iter(runtime.tool_bridge._contexts.values()))
                    output["rejected_results_not_released"] = (
                        bool(context.pending_call_ids)
                        and not (context.directory / "results").exists()
                    )
                resumed_again = await adapter.complete(
                    ChatCompletionRequest(
                        model=profile.name,
                        tools=tool_request.tools,
                        messages=[
                            *tool_request.messages,
                            called_again["choices"][0]["message"],
                            *[
                                {
                                    "role": "tool",
                                    "tool_call_id": c["id"],
                                    "content": "lookup succeeded",
                                }
                                for c in pending_calls
                            ],
                        ],
                    ),
                    profile,
                )
                output["second_resumed_content"] = resumed_again["choices"][0]["message"]["content"]
                for context in list(runtime.tool_bridge._contexts.values()):
                    await adapter._cleanup_context(context)
                output["mcp_entries_after_two_cleanups"] = len(
                    (
                        await client.get(
                            runtime.base_url + "/mcp",
                            params={"directory": folder},
                            auth=runtime.auth,
                        )
                    ).json()
                )
        except Exception as e:  # noqa: BLE001 - preserve diagnostic JSON and fail the gate below
            output["error"] = {"type": type(e).__name__, "message": str(e)[:1500]}
        finally:
            await runtime.close()
    server.shutdown()
    output["fake_provider_requests"] = requests_seen
    print(json.dumps(output, ensure_ascii=False, indent=2))
    assert "error" not in output, output.get("error")
    assert output["unauthenticated_session_create_status"] == 401
    assert output["unauthenticated_health_status"] == 401
    assert (
        output["plain_content"]
        == output["resumed_content"]
        == output["second_resumed_content"]
        == "AUDIT_OK"
    )
    assert output["changed_contract_rejected"] and output["rejected_results_not_released"]
    assert output["mcp_entries_after_two_cleanups"] == 1
    assert not any(item["history_in_system"] for item in requests_seen)


asyncio.run(main())
