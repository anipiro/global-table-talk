import { describe, expect, it } from "vitest";
import { cancellationResponse, isRequestCancellation } from "./request-cancellation";

describe("request cancellation", () => {
  it("recognizes canceled image fetches without treating normal failures as cancellation", () => {
    expect(isRequestCancellation(new DOMException("This operation was aborted", "AbortError"))).toBe(true);
    expect(isRequestCancellation(new Error("Image generation failed"))).toBe(false);
  });
  it("recognizes a disconnected caller even when a provider wraps the abort", () => {
    const controller = new AbortController();
    controller.abort();
    expect(isRequestCancellation(new Error("No output generated"), controller.signal)).toBe(true);
  });
  it("returns a terminal 499 cancellation response instead of a 500 error", async () => {
    const response = cancellationResponse();
    expect(response.status).toBe(499);
    expect(await response.json()).toEqual({ cancelled: true });
  });
});