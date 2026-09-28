// Page rasters are reading/export evidence, never viewport click coordinates.
export const CAPTURE_MAX_PIXELS = 32 * 1024 * 1024;
const secretFields = 'input[type="password"],input[autocomplete^="cc-"],input[name*="token" i],textarea[name*="token" i],input[name*="secret" i],textarea[name*="secret" i],input[name*="api_key" i],textarea[name*="api_key" i]';

function layout() {
  const root = document.documentElement, body = document.body;
  return {width: innerWidth, height: innerHeight, scrollX, scrollY,
    documentWidth: Math.max(root.clientWidth, root.scrollWidth, root.offsetWidth, body?.clientWidth || 0, body?.scrollWidth || 0, body?.offsetWidth || 0),
    documentHeight: Math.max(root.clientHeight, root.scrollHeight, root.offsetHeight, body?.clientHeight || 0, body?.scrollHeight || 0, body?.offsetHeight || 0)};
}
function pngSize(bytes) {
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || magic.some((value, index) => bytes[index] !== value)) throw new Error('capture_incomplete');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {width: header.getUint32(16), height: header.getUint32(20)};
}
function checkSize(width, height) {
  if (!width || !height || width > 32768 || height > 32768 || width * height > CAPTURE_MAX_PIXELS) throw new Error('capture_too_large');
}
export function captureRegion(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'height,width,x,y' ||
      !Object.values(value).every(Number.isSafeInteger) || value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1) throw new Error('tool_arguments_invalid');
  checkSize(value.width, value.height);
  return value;
}
export function screenshotOptions(value) {
  if (value === undefined) return {full_page: true};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['fullPage','region'].includes(key)) ||
      value.fullPage !== undefined && typeof value.fullPage !== 'boolean' || value.region !== undefined && value.fullPage !== false) throw new Error('tool_arguments_invalid');
  const region = captureRegion(value.region);
  return {full_page: value.fullPage !== false, ...(region ? {region} : {})};
}
async function withinCaptureDeadline(operation, deadline, cancelled) {
  if (cancelled()) throw new Error('cancelled');
  const remaining=deadline-Date.now();
  if (remaining<=0) throw new Error('capture_timeout');
  let timer, watcher;
  try{return await Promise.race([operation(),new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('capture_timeout')),remaining);
    watcher=setInterval(()=>{if(cancelled())reject(new Error('cancelled'));},50);
  })]);}
  finally{clearTimeout(timer);clearInterval(watcher);}
}

// Coverage describes geometry and known omissions, not semantic completeness.
// Keep current refs in the tool result only; never persist them with the PNG.
export function captureCoverage(screenshot, observation) {
  const fullPage = screenshot.mode === 'page', region = screenshot.mode === 'region', frames = observation?.frames || [];
  const nested = frames.flatMap(frame => (frame.elements || []).filter(el => el.scroll).map(el => ({
    frame: frame.frame, ref: el.ref, ...el.scroll, inViewport: el.inViewport,
  })));
  const count = key => frames.reduce((sum, frame) => sum + (Number(frame.surfaces?.[key]) || 0), 0);
  const pendingImages = count('pendingImages'), failedImages = count('failedImages');
  const detailRecommended = fullPage && (screenshot.width > screenshot.viewportWidth || screenshot.height > screenshot.viewportHeight * 2);
  const partialDOM = !frames.length || frames.some(frame => frame.unavailable || frame.coverage?.domTruncated || frame.omittedControls > 0 || frame.coverage?.queryFiltered) ||
    ['unavailable', 'omitted', 'excluded'].some(key => observation?.frameCoverage?.[key] > 0);
  return {scope: fullPage ? 'rendered_document' : region ? 'viewport_region' : 'viewport', allContentVerified: false,
    detailRecommended,
    document: {width: screenshot.documentWidth, height: screenshot.documentHeight},
    captured: {x: fullPage ? 0 : screenshot.scrollX + (screenshot.region?.x || 0), y: fullPage ? 0 : screenshot.scrollY + (screenshot.region?.y || 0), width: screenshot.width, height: screenshot.height},
    pendingImages, failedImages, nestedScrollAreas: nested.slice(0, 12), omittedScrollAreas: Math.max(0, nested.length - 12),
    framesObserved: frames.length, observationPartial: partialDOM,
    next: pendingImages ? 'wait_then_reobserve' : nested.length ? 'inspect_relevant_scroll_area' : detailRecommended ? 'inspect_relevant_sections' : fullPage ? 'verify_required_content' : 'inspect_remaining_sections',
    instruction: 'This PNG covers only the captured rectangle at this moment. A long or wide overview may be reduced by the vision provider: use DOM text for precise reading and capture_page({full_page:false}) after scrolling to required details. Overview and region pixels are NOT viewport click coordinates; use a fresh uncropped viewport capture or semantic ref to act. Nested scroll refs belong to the accompanying observation. For required missing content use scroll_page(direction, ref), inspect its movement and fresh observation, then capture the next section. Keep overlapping sections; never repeat a blocked scroll unchanged. Pending images need a bounded wait and re-observation; a broken image is not loading. Virtual rows, collapsed content, covered areas and undiscovered frames may remain. Reaching a scroll boundary is not proof that all data or acceptance criteria were verified.'};
}
export async function captureBrowserPage(page, {fullPage = true, region, cancelled = () => false, deadlineMs = 16000} = {}) {
  if (typeof fullPage !== 'boolean') throw new Error('tool_arguments_invalid');
  const selected = captureRegion(region);
  if (selected && fullPage) throw new Error('tool_arguments_invalid');
  const deadline=Date.now()+deadlineMs;
  const masks = page.frames().map(frame => frame.locator(secretFields));
  for (let attempt = 0; attempt < 2; attempt++) {
    if (cancelled()) throw new Error('cancelled');
    const url = page.url(), before = await withinCaptureDeadline(()=>page.evaluate(layout),deadline,cancelled);
    if (selected && (selected.x + selected.width > before.width || selected.y + selected.height > before.height)) throw new Error('tool_arguments_invalid');
    checkSize(fullPage ? before.documentWidth : before.width, fullPage ? before.documentHeight : before.height);
    const bytes = await withinCaptureDeadline(()=>page.screenshot({type: 'png', scale: 'css', style: 'nubi-action-pointer { visibility: hidden !important; }', fullPage, ...(selected ? {clip: selected} : {}), mask: masks, maskColor: '#E5E8EB', timeout: Math.min(7000,Math.max(1,deadline-Date.now()))}),deadline,cancelled);
    const after = await withinCaptureDeadline(()=>page.evaluate(layout),deadline,cancelled);
    if (cancelled()) throw new Error('cancelled');
    const keys = fullPage ? Object.keys(before) : ['width', 'height', 'scrollX', 'scrollY'];
    if (page.url() !== url || keys.some(key => before[key] !== after[key])) continue;
    const dimensions = pngSize(bytes);
    checkSize(dimensions.width, dimensions.height);
    if (dimensions.width !== (selected?.width || (fullPage ? before.documentWidth : before.width)) || dimensions.height !== (selected?.height || (fullPage ? before.documentHeight : before.height))) throw new Error('capture_incomplete');
    const data = bytes.toString('base64');
    if (data.length > 6000000) throw new Error('capture_too_large');
    return {screenshot: {id: crypto.randomUUID(), ...before, ...dimensions, viewportWidth: before.width, viewportHeight: before.height, mode: fullPage ? 'page' : selected ? 'region' : 'viewport', ...(selected ? {region: selected} : {}), url, at: Date.now()},
      viewport: {width: before.width, height: before.height, scrollX: before.scrollX, scrollY: before.scrollY}, image: {data, mimeType: 'image/png'}};
  }
  throw Object.assign(new Error('browser_stale'), {reason: 'viewport_changed'});
}
