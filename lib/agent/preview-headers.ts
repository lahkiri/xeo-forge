/**
 * Response headers that untrusted preview content must never control.
 * The preview is proxied on the application's origin.
 */
export const STRIP_PREVIEW_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'x-frame-options',
  'content-security-policy',
  'set-cookie',
  'location',
  'www-authenticate',
  'proxy-authenticate',
]);

export function shouldForwardPreviewResponseHeader(name: string): boolean {
  return !STRIP_PREVIEW_RESPONSE_HEADERS.has(name.toLowerCase());
}
