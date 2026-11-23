// What the window opens on (pure; tests/launch.test.ts). Live when the app starts its own bridge, or when a bridge
// already answers at the bridge address; the demo replay only when no bridge answers.

/** true when a bridge answers GET /v0/status at base within ms */
export async function probeBridge(base, fetchFn = fetch, ms = 800) {
  try {
    const r = await fetchFn(String(base).replace(/\/$/, '') + '/v0/status', { headers: { 'X-Contract': '1' }, signal: AbortSignal.timeout(ms) });
    return !!r.ok;
  } catch { return false; }
}

/** the page's query: adds src=live&bridge=<address> unless the query already names a source */
export async function launchQuery(query, { startBridge, bridgeAddress, capture }, probe = probeBridge) {
  const q = query || '';
  if (/(^|[?&])src=/.test(q)) return q;
  const live = `src=live&bridge=${encodeURIComponent(bridgeAddress)}`;
  const add = () => q + (q ? '&' : '?') + live;
  if (startBridge) return add();
  if (!capture && await probe(bridgeAddress)) return add();
  return q;
}
