/**
 * lib/ssrf.ts — SSRF guard for agent-supplied webhook URLs.
 *
 * Agent webhook registration lets any authenticated wallet name an arbitrary
 * URL that the API server will later POST to (with a server-controlled HMAC
 * header). Without validation that is a classic SSRF: a caller could target
 * `http://169.254.169.254/...` (cloud metadata), loopback, or RFC1918 internal
 * services from inside our own network. We validate the URL's scheme and
 * resolve its host, rejecting any address in a private/reserved range — both
 * at registration time AND again at delivery time (guards against DNS
 * rebinding, where a name resolves to a public IP at registration and a private
 * one at delivery).
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

export class SsrfError extends Error {}

/** True for IPv4/IPv6 addresses that must never be reachable from a webhook. */
function isBlockedAddress(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) {
    const p = ip.split(".").map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const a = p[0]!;
    const b = p[1]!;
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // 10/8 private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
    if (a === 192 && b === 168) return true; // 192.168/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return false;
  }
  return true; // not a literal IP — caller resolves the host first
}

/**
 * Validates a webhook URL: https/http scheme only, host resolves to a public
 * address. Throws SsrfError on any violation. Returns the parsed URL.
 */
export async function assertPublicWebhookUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError("Malformed webhook URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SsrfError(`Unsupported webhook scheme: ${url.protocol}`);
  }
  const host = url.hostname;

  // Literal IP in the URL — check directly, no DNS.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new SsrfError(`Webhook host ${host} is a private/reserved address.`);
    return url;
  }

  // Hostname — resolve ALL addresses and reject if any is private (defeats
  // "return one public + one private" tricks).
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new SsrfError(`Webhook host ${host} could not be resolved.`);
  }
  if (records.length === 0) throw new SsrfError(`Webhook host ${host} resolved to no addresses.`);
  for (const r of records) {
    if (isBlockedAddress(r.address)) {
      throw new SsrfError(`Webhook host ${host} resolves to a private/reserved address (${r.address}).`);
    }
  }
  return url;
}
