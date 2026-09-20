/**
 * Where the assistant's browser may go.
 *
 * A browser driven by a model is a way for anything it reads to reach the
 * network this server sits on. So the rules are narrow and checked on every
 * navigation, including redirects and the page's own sub-requests:
 *
 *   * https (and plain http only where explicitly allowed), standard ports;
 *   * the host must be on the organization's own list of sites - an empty list
 *     means no browsing at all;
 *   * every address the host resolves to must be a public one, so a name that
 *     points at 127.0.0.1, a private range or a cloud metadata address is
 *     refused however it is spelled.
 */

import dns from 'dns/promises';
import net from 'net';
import { AssistantError } from '../assistant.logic';

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);
const ALLOWED_PORTS = new Set(['', '80', '443', '8443']);

/** Addresses that are never on the public internet. */
export function isPublicAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    const [a, b] = parts as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local, and cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return false;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false; // unique local
    if (lower.startsWith('fe80')) return false; // link-local
    if (lower.startsWith('::ffff:')) return isPublicAddress(lower.slice(7));
    return true;
  }
  return false;
}

/** Whether a host is covered by one of the allowed domains. */
export function hostIsAllowed(host: string, allowedDomains: string[]): boolean {
  const lower = host.toLowerCase();
  return allowedDomains.some(domain => {
    const clean = domain.toLowerCase().replace(/^\*\./, '');
    return lower === clean || lower.endsWith(`.${clean}`);
  });
}

export interface BrowsePolicyOptions {
  allowedDomains: string[];
  /** Plain http, for a site that genuinely has no certificate. */
  allowInsecure?: boolean;
}

/**
 * Check a URL before it is opened, and return it normalised.
 *
 * Throws an `AssistantError` whose message explains what would have to change,
 * because this refusal is usually read by the person who set the list up.
 */
export async function assertBrowserUrl(raw: string, options: BrowsePolicyOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AssistantError(`${raw} is not a web address.`, 'INVALID_URL');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new AssistantError('Only web pages can be opened, over http or https.', 'PROTOCOL_NOT_ALLOWED');
  }
  if (url.protocol === 'http:' && !options.allowInsecure) {
    throw new AssistantError(`${url.hostname} would be opened without encryption, which is not allowed.`, 'INSECURE_URL');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new AssistantError(`Port ${url.port} is not a normal web port, so it will not be opened.`, 'PORT_NOT_ALLOWED');
  }
  if (url.username || url.password) {
    throw new AssistantError('A web address with a username and password in it will not be opened.', 'CREDENTIALS_IN_URL');
  }

  if (options.allowedDomains.length === 0) {
    throw new AssistantError(
      'No websites have been allowed for the assistant. Add the sites it may visit in Settings → Agentic Assistant.',
      'NO_ALLOWED_DOMAINS'
    );
  }
  if (!hostIsAllowed(url.hostname, options.allowedDomains)) {
    throw new AssistantError(
      `${url.hostname} is not on the list of websites the assistant may visit.`,
      'DOMAIN_NOT_ALLOWED'
    );
  }

  // A literal address skips DNS, so it is checked directly.
  if (net.isIP(url.hostname)) {
    if (!isPublicAddress(url.hostname)) {
      throw new AssistantError('That address is inside the network, so it will not be opened.', 'PRIVATE_ADDRESS');
    }
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new AssistantError(`${url.hostname} could not be found.`, 'HOST_NOT_FOUND');
  }
  if (addresses.length === 0 || addresses.some(entry => !isPublicAddress(entry.address))) {
    throw new AssistantError(
      `${url.hostname} points at an address inside the network, so it will not be opened.`,
      'PRIVATE_ADDRESS'
    );
  }

  return url;
}

/**
 * The same check for a sub-request a page makes.
 *
 * Returns a reason rather than throwing: this runs inside the browser's
 * request handler, where the only options are continue or abort.
 */
export async function subRequestAllowed(raw: string, options: BrowsePolicyOptions): Promise<boolean> {
  try {
    const url = new URL(raw);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
    if (net.isIP(url.hostname)) return isPublicAddress(url.hostname);
    const addresses = await dns.lookup(url.hostname, { all: true });
    return addresses.length > 0 && addresses.every(entry => isPublicAddress(entry.address));
  } catch {
    return false;
  }
}
