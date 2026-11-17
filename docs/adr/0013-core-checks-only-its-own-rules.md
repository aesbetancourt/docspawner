# The core checks only its own rules, without Zod

Status: accepted. It changes the package rule of ADR-0004.

The request rules were written twice: JSON Schema in the HTTP adapter and Zod in the core. Zod also needed custom issue parameters to report a size limit as `input_too_large`, and a cache for the schema.

Now each layer checks one thing:

| Layer             | Checks                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A driving adapter | The shape of its input. The HTTP adapter uses JSON Schema.                                                                         |
| The core          | Rules that are true for every adapter: no empty template, the size limits in bytes, and the ranges of `timeoutMs` and `timestamp`. |

The core trusts the `RenderRequest` type. A new driving adapter, for example a queue consumer, must check the shape of its own input.

`application/service` may use no packages. Zod stays in `config.ts` for the environment variables.
