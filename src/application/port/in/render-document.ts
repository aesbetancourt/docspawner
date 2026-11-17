// Inbound port: what the worker offers. Driving adapters (HTTP) call it. The render service implements it.
import type { RenderRequest, RenderResult } from "../../../domain/render.js";

/** The one use case of the worker: turn a template and data into a PDF. */
export interface RenderDocument {
  /**
   * Render one request to a PDF.
   * @param request - The template, the data, and optional settings.
   * @returns The PDF and its metadata, or an expected error as a value.
   * @throws Error only for a real fault, for example when the Typst binary cannot start.
   */
  render(request: RenderRequest): Promise<RenderResult>;
}
