import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  ip: string;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();
