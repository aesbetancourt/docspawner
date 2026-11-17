// Inbound port: what the worker offers. Driving adapters (HTTP) call it. The render service implements it.
import type { RenderRequest, RenderResult } from "../../../domain/render.js";

export interface RenderDocument {
  render(request: RenderRequest): Promise<RenderResult>;
}
