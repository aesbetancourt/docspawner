# Run the Typst CLI as a new process for each render

Status: accepted

The `TypstCompiler` adapter writes `main.typ` and `data.json` to a new temp folder, runs the `typst` binary, and reads the PDF. We do not embed Typst as a library.

A separate process gives isolation that an embedded compiler does not: on timeout we kill the process, a crash cannot take down the server, and memory is returned to the OS after each render. The cost is a process start per render. The example invoice still renders in about 19 ms (p50).

## Considered options

- **Embed the Typst Rust crate**: fastest and no temp files, but it requires a Rust service or native bindings, and a runaway compile cannot be killed safely.
- **Node binding (typst.ts)**: in-process and no binary to install, but the same isolation problem, and it is less mature.
- **CLI process**: **chosen**. It can be swapped behind the `TypstCompiler` port without changing the API.

## Consequences

- Errors come back as text, so the adapter parses them. We parse the "human" format, not the "short" one, because only the human format includes Typst's hints. Agents use those hints to fix templates.
- Typst prints 0-based columns. The parser converts them to 1-based, which editors and agents expect.
- The `typst` binary must be installed. The Docker image includes a pinned version.
