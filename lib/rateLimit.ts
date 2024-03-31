export const lastRequestTimeMap: Map<string, number> = new Map();

export function rateLimit(info: Deno.ServeHandlerInfo) {
  const lastRequestTime = lastRequestTimeMap.get(info.remoteAddr.hostname);
  if (!lastRequestTime) return false;
  return Date.now() - lastRequestTime < 200;
}
