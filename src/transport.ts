import { IgdbError, type IgdbErrorPhase } from "./errors.js";

export type IgdbClientOptions = {
  clientId: string;
  fetch?: typeof globalThis.fetch;
  /** Total time for one request, including authentication and the optional 401 retry. */
  timeoutMs?: number;
} & ({ accessToken: string; clientSecret?: never } | { clientSecret: string; accessToken?: never });

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Transport {
  request(endpoint: string, body: string, options?: RequestOptions): Promise<unknown>;
}

type Token = { value: string; expiresAt: number };
type Deadline = {
  signal: AbortSignal;
  error(phase: IgdbErrorPhase): IgdbError;
  dispose(): void;
};

function validateTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
    throw new TypeError("timeoutMs must be a positive number no greater than 2147483647.");
  }
  return value;
}

function deadline(timeoutMs: number, external?: AbortSignal): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (external?.aborted) abort();
  else external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, timeoutMs);
  return {
    signal: controller.signal,
    error: (phase) => new IgdbError(timedOut ? "TIMEOUT" : "ABORTED", phase),
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
    },
  };
}

/** Also bounds custom fetch implementations that do not honor AbortSignal. */
function within<T>(promise: Promise<T>, budget: Deadline, phase: IgdbErrorPhase): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      budget.signal.removeEventListener("abort", abort);
      reject(budget.error(phase));
    };
    budget.signal.addEventListener("abort", abort, { once: true });
    if (budget.signal.aborted) abort();
    promise.then(
      (value) => {
        budget.signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        budget.signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : undefined;
  }
  // Date.parse also accepts inputs such as "-1" that are not HTTP dates.
  if (!/[A-Za-z]/.test(value)) return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : undefined;
}

export function createTransport(options: IgdbClientOptions): Transport {
  const { clientId, accessToken, clientSecret } = options;
  if (typeof clientId !== "string" || !clientId.trim() || /[\r\n]/.test(clientId)) {
    throw new TypeError("clientId must be a non-empty string without line breaks.");
  }
  if ((accessToken !== undefined) === (clientSecret !== undefined)) {
    throw new TypeError("Provide exactly one of accessToken or clientSecret.");
  }
  const credential = accessToken ?? clientSecret;
  if (typeof credential !== "string" || !credential.trim() || /[\r\n]/.test(credential)) {
    throw new TypeError(
      "The authentication credential must be a non-empty string without line breaks.",
    );
  }
  const defaultTimeout = validateTimeout(options.timeoutMs ?? 10_000);
  const configuredFetch = options.fetch;
  let cached: Token | undefined;
  let pending: Promise<Token> | undefined;

  async function json(
    url: string,
    init: RequestInit,
    phase: IgdbErrorPhase,
    budget: Deadline,
  ): Promise<unknown> {
    if (budget.signal.aborted) throw budget.error(phase);
    let response: Response;
    try {
      response = await within(
        (configuredFetch ?? globalThis.fetch)(url, {
          ...init,
          redirect: "error",
          signal: budget.signal,
        }),
        budget,
        phase,
      );
    } catch {
      if (budget.signal.aborted) throw budget.error(phase);
      throw new IgdbError("NETWORK_ERROR", phase);
    }
    if (!response.ok) {
      // An upstream error body can echo submitted credentials or query text.
      // Discard it instead of exposing or parsing it in a public error.
      void response.body?.cancel().catch(() => {});
      const seconds = retryAfter(response);
      throw new IgdbError("HTTP_ERROR", phase, {
        status: response.status,
        ...(seconds === undefined ? {} : { retryAfter: seconds }),
      });
    }
    try {
      return await within(response.json(), budget, phase);
    } catch {
      if (budget.signal.aborted) throw budget.error(phase);
      throw new IgdbError("INVALID_RESPONSE", phase);
    }
  }

  async function acquire(): Promise<Token> {
    // A caller's cancellation must not cancel authentication needed by other callers.
    const budget = deadline(defaultTimeout);
    try {
      const data = await json(
        "https://id.twitch.tv/oauth2/token",
        {
          method: "POST",
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret!,
            grant_type: "client_credentials",
          }),
        },
        "auth",
        budget,
      );
      if (
        typeof data !== "object" ||
        data === null ||
        !("access_token" in data) ||
        typeof data.access_token !== "string" ||
        !data.access_token.trim() ||
        /[\r\n]/.test(data.access_token) ||
        !("expires_in" in data) ||
        typeof data.expires_in !== "number" ||
        !Number.isFinite(data.expires_in * 1000) ||
        data.expires_in <= 0
      ) {
        throw new IgdbError("INVALID_RESPONSE", "auth");
      }
      const lifetime = data.expires_in * 1000;
      return {
        value: data.access_token,
        expiresAt: Date.now() + lifetime - Math.min(60_000, lifetime / 10),
      };
    } finally {
      budget.dispose();
    }
  }

  function getToken(): Promise<Token> {
    if (accessToken !== undefined)
      return Promise.resolve({ value: accessToken, expiresAt: Infinity });
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);
    if (pending) return pending;
    const operation = acquire();
    pending = operation;
    void operation.then(
      (token) => {
        cached = token;
        if (pending === operation) pending = undefined;
      },
      () => {
        if (pending === operation) pending = undefined;
      },
    );
    return operation;
  }

  return {
    async request(endpoint, body, requestOptions = {}) {
      if (!/^[a-z][a-z0-9_]*$/.test(endpoint)) throw new TypeError("Invalid IGDB endpoint.");
      if (typeof body !== "string") throw new TypeError("The query body must be a string.");
      const budget = deadline(
        validateTimeout(requestOptions.timeoutMs ?? defaultTimeout),
        requestOptions.signal,
      );
      try {
        for (let attempt = 0; ; attempt++) {
          const phase = clientSecret === undefined ? "request" : "auth";
          if (budget.signal.aborted) throw budget.error(phase);
          const token = await within(getToken(), budget, phase);
          try {
            return await json(
              `https://api.igdb.com/v4/${endpoint}`,
              {
                method: "POST",
                headers: {
                  "Client-ID": clientId,
                  Authorization: `Bearer ${token.value}`,
                  "Content-Type": "text/plain",
                },
                body,
              },
              "request",
              budget,
            );
          } catch (error) {
            if (
              clientSecret !== undefined &&
              error instanceof IgdbError &&
              error.code === "HTTP_ERROR" &&
              error.status === 401
            ) {
              // An older in-flight request must not evict a more recently acquired token.
              if (cached === token) cached = undefined;
              if (attempt === 0) continue;
            }
            throw error;
          }
        }
      } finally {
        budget.dispose();
      }
    },
  };
}
