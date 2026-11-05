/** Retry only model-service requests. No Windows action is ever dispatched here. */
export async function retryTransientModelRequest(
  send: () => Promise<Response>,
  options: {
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (status: number | "network", attempt: number) => void;
  } = {},
): Promise<Response> {
  const sleep = options.sleep ?? ((ms: number) =>
    new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await send();
    } catch (error) {
      // A connection failure can leave the model request's outcome uncertain,
      // but retrying a proposal is safe: native actions execute only on Windows.
      if (attempt >= 3 || !(error instanceof TypeError ||
        (error instanceof DOMException && ["TimeoutError", "NetworkError"].includes(error.name)))) {
        throw error;
      }
      options.onRetry?.("network", attempt);
      await sleep(attempt * 500);
      continue;
    }
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt >= 3) return response;
    options.onRetry?.(response.status, attempt);
    await response.body?.cancel().catch(() => undefined);
    await sleep(attempt * 500);
  }
  throw new Error("Model retry attempts exhausted.");
}
