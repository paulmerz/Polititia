import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  ip: string;
  socketIp?: string;
  headers?: Headers;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Better Auth reads the client address from this header only. The server
// overwrites it on every request it hands over, so a client cannot choose it.
export const CLIENT_IP_HEADER = "x-polititia-client-ip";

export function withClientIp(headers: Headers, ip: string): Headers {
  const copy = new Headers(headers);
  copy.set(CLIENT_IP_HEADER, ip);
  return copy;
}
