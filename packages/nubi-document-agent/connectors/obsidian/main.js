"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../nubi-document-agent/connectors/obsidian/plugin.ts
var plugin_exports = {};
__export(plugin_exports, {
  default: () => NubiPlugin
});
module.exports = __toCommonJS(plugin_exports);
var import_obsidian = require("obsidian");
var import_node_http = require("node:http");

// ../nubi-document-agent/src/contracts.ts
var DocumentAgentError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "DocumentAgentError";
  }
};
function fail(code) {
  throw new DocumentAgentError(code);
}
function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return fail("invalid_data");
}

// ../nubi-document-agent/src/editor-adapters.ts
var check = (signal) => {
  if (signal.aborted) fail("operation_cancelled");
};
function validatePatch(before, patch) {
  if (!Number.isSafeInteger(patch.start) || !Number.isSafeInteger(patch.end) || patch.start < 0 || patch.end < patch.start || patch.end > before.text.length || typeof patch.newText !== "string" || patch.newText.length > 12e3 || patch.newText.includes("\0") || before.text.slice(patch.start, patch.end) !== patch.oldText) fail("editor_patch_invalid");
}
function writable(current, before, patch) {
  validatePatch(before, patch);
  if (current.readOnly || canonical(current.binding) !== canonical(before.binding) || current.revision !== before.revision || current.text !== before.text) fail("editor_changed");
}
var receipt = () => ({ status: "confirmed", receiptId: crypto.randomUUID() });
function createObsidianEditorPort(connection) {
  const editor = connection.editor;
  const binding = { connectionId: connection.connectionId, documentId: connection.documentId, mode: "external", app: "obsidian" };
  function inspect() {
    if (!connection.isConnected() || connection.editor !== editor) fail("editor_disconnected");
    return { binding: { ...binding }, revision: String(connection.revision()), text: editor.getValue(), selection: { start: editor.posToOffset(editor.getCursor("from")), end: editor.posToOffset(editor.getCursor("to")) }, readOnly: connection.readOnly(), dirty: connection.dirty() };
  }
  return {
    async inspect(signal) {
      check(signal);
      return inspect();
    },
    async replaceIfCurrent(before, patch, signal) {
      check(signal);
      writable(inspect(), before, patch);
      editor.replaceRange(patch.newText, editor.offsetToPos(patch.start), editor.offsetToPos(patch.end), "nubi.document-agent");
      return receipt();
    }
  };
}

// ../nubi-document-agent/connectors/obsidian/plugin.ts
function rpc(port, token, path, data) {
  return new Promise((resolve, reject) => {
    const bytes = JSON.stringify(data);
    const req = (0, import_node_http.request)({ hostname: "127.0.0.1", port, path, method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bytes) }, timeout: 15e3 }, (res) => {
      res.setEncoding("utf8");
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 22e5) req.destroy(Error("editor_response_limit"));
      });
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) throw Error("editor_disconnected");
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Error("editor_timeout")));
    req.end(bytes);
  });
}
var NubiPlugin = class extends import_obsidian.Plugin {
  stop = () => {
  };
  onload() {
    this.addCommand({ id: "connect-current-document", name: "\uB204\uBE44\uC5D0 \uD604\uC7AC \uBB38\uC11C \uC5F0\uACB0", editorCallback: (editor, context) => {
      const view = context, file = view.file;
      if (!file || typeof view.getMode !== "function" || view.getMode() !== "source") {
        new import_obsidian.Notice("\uD3B8\uC9D1 \uBAA8\uB4DC\uC5D0\uC11C \uBB38\uC11C\uB97C \uC5F4\uC5B4 \uC8FC\uC138\uC694.");
        return;
      }
      const modal = new import_obsidian.Modal(this.app);
      modal.titleEl.setText("\uB204\uBE44 Workspace \uC5F0\uACB0");
      let code = "", paired = false;
      let stopAttempt;
      modal.onClose = () => {
        if (!paired) stopAttempt?.();
      };
      new import_obsidian.Setting(modal.contentEl).setName("\uC5F0\uACB0 \uCF54\uB4DC").addText((input) => input.onChange((v) => code = v.trim()));
      new import_obsidian.Setting(modal.contentEl).addButton((button) => button.setButtonText("\uD604\uC7AC \uBB38\uC11C \uC5F0\uACB0").setCta().onClick(async () => {
        const match = /^nubi-editor:(\d{1,5}):([a-f0-9-]{72})$/.exec(code);
        if (!match || +match[1] > 65535 || +match[1] < 1) {
          new import_obsidian.Notice("\uB204\uBE44\uC5D0\uC11C \uBCF5\uC0AC\uD55C \uC5F0\uACB0 \uCF54\uB4DC\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.");
          return;
        }
        button.setDisabled(true);
        this.stop();
        let closed = false, timer, revision = 1;
        const controller = new AbortController(), port = +match[1];
        let token = "";
        const change = this.app.workspace.on("editor-change", (changed) => {
          if (changed === editor) revision++;
        });
        const connected = () => !closed && view.file === file && view.editor === editor && view.getMode() === "source" && this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view);
        const stop = () => {
          if (closed) return;
          closed = true;
          controller.abort();
          window.clearTimeout(timer);
          this.app.workspace.offref(change);
          if (token) void rpc(port, token, "/disconnect", {}).catch(() => {
          });
        };
        this.stop = stop;
        stopAttempt = stop;
        try {
          const result = await rpc(port, match[2], "/connect", { documentId: file.path, title: file.name });
          token = result.token;
          if (closed) {
            void rpc(port, token, "/disconnect", {}).catch(() => {
            });
            return;
          }
          if (!connected()) {
            stop();
            return;
          }
          const adapter = createObsidianEditorPort({ connectionId: result.binding.connectionId, documentId: file.path, editor, isConnected: connected, readOnly: () => view.getMode() !== "source", revision: () => revision, dirty: () => "unknown" });
          const poll = async () => {
            if (!connected()) {
              stop();
              return;
            }
            try {
              const { requests } = await rpc(port, token, "/poll", {});
              for (const item of requests) {
                let value, error;
                try {
                  value = item.operation === "inspect" ? await adapter.inspect(controller.signal) : item.operation === "replace" ? await adapter.replaceIfCurrent(item.args.before, item.args.patch, controller.signal) : null;
                } catch {
                  error = "editor_adapter_failed";
                }
                await rpc(port, token, "/reply", { id: item.id, value, error });
              }
              if (!closed) timer = window.setTimeout(poll, 250);
            } catch {
              stop();
              new import_obsidian.Notice("\uB204\uBE44 \uBB38\uC11C \uC5F0\uACB0\uC774 \uC885\uB8CC\uB410\uC5B4\uC694.");
            }
          };
          void poll();
          paired = true;
          modal.close();
          new import_obsidian.Notice("\uB204\uBE44\uC5D0\uC11C \uBB38\uC11C \uC774\uB984\uC744 \uD655\uC778\uD558\uACE0 \uC5F0\uACB0\uD574 \uC8FC\uC138\uC694.");
        } catch {
          stop();
          new import_obsidian.Notice("\uB204\uBE44 \uC5F0\uACB0\uC744 \uD655\uC778\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694.");
          button.setDisabled(false);
        }
      }));
      modal.open();
    } });
    this.addCommand({ id: "disconnect-document", name: "\uB204\uBE44 \uBB38\uC11C \uC5F0\uACB0 \uD574\uC81C", callback: () => this.stop() });
  }
  onunload() {
    this.stop();
  }
};
