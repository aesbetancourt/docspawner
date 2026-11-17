# Treat every template as untrusted code

Status: accepted

A Typst template is a program: it has loops, functions, and file reads. The caller (or an AI agent) writes it, so docspawner must contain it.

| Risk                    | Control                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| Endless or slow compile | Timeout (default 10 s, max 60 s), then `SIGKILL`                         |
| Large input             | Template max 1 MB, data max 5 MB, HTTP body max 8 MB                     |
| Read host files         | Typst can only read inside its root, a new temp folder per render        |
| Network                 | Package downloads are blocked; only allowlisted packages (ADR-0012)      |
| Resource use            | Docker: read-only file system, `tmpfs` for `/tmp`, memory and CPU limits |

Typst has no option to turn off package downloads. We set `HTTPS_PROXY` (and the related variables) to an address where nothing listens. The download fails at once with a clear error, and the adapter adds a hint. We also point the package cache to an empty folder, so a package cached on the host cannot change the output. This looks strange in the code, so it is recorded here. Templates can import only the packages pre-installed from the allowlist (ADR-0012), through `packagePath`.
