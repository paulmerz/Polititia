import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  ip: string;
  headers?: Headers;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();
