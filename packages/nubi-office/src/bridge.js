const pending = new Map();
if (globalThis.chrome?.webview) chrome.webview.addEventListener('message', ({data}) => {
  const item = pending.get(data?.id); if (!item) return; pending.delete(data.id); clearTimeout(item.timer);
  data.ok ? item.resolve(data.result) : item.reject(new Error(data.error || 'office_failed'));
});
export function rpc(method, payload = {}) {
  if (!globalThis.chrome?.webview) return Promise.reject(new Error('excel_host_required'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {pending.delete(id); reject(new Error('office_timeout'));}, ['document_skill_import','document_open','document_save','template_register','template_open','office_save','office_create','office_copy','office_template_register','template_catalog_use','template_catalog_index'].includes(method)?180000:35000);
    pending.set(id, {resolve, reject, timer}); chrome.webview.postMessage({id, method, payload});
  });
}
