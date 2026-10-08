import type { ErrorKey } from "./i18n_catalogs";

export class TimelineRequestError extends Error {
  constructor(readonly code: ErrorKey) {
    super(code);
    this.name = "TimelineRequestError";
  }
}

export function httpErrorKey(
  status: number,
  fallback: ErrorKey = "error.load",
): ErrorKey {
  switch (status) {
    case 401:
      return "error.unauthorized";
    case 403:
      return "error.forbidden";
    case 404:
      return "error.notFound";
    default:
      return status >= 500 ? "error.server" : fallback;
  }
}

export function errorKey(error: unknown, fallback: ErrorKey): ErrorKey {
  if (error instanceof TimelineRequestError) return error.code;
  if (error instanceof TypeError) return "error.network";
  if (error instanceof SyntaxError) return "error.invalidResponse";
  return fallback;
}
