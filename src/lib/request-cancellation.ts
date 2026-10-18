/** Caller disconnects are expected control flow, not failed AI jobs. */
export function isRequestCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

export function cancellationResponse() {
  return new Response(JSON.stringify({ cancelled: true }), {
    status: 499,
    headers: { "Content-Type": "application/json" },
  });
}