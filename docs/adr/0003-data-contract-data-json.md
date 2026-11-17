# Data reaches the template as the file data.json

Status: accepted

The only contract between docspawner and a template: the data is a file named `data.json` next to the template, and the template reads it with `#let data = json("data.json")`. Every template written for docspawner depends on this name, so changing it later breaks all callers.

## Considered options

- **`sys.inputs`**: Typst's CLI flag for inputs. Values are always strings, so the template must parse them (`json(bytes(sys.inputs.data))`), and large data goes through process arguments, which have size limits.
- **Virtual file `data.json`**: plain Typst, no size limit from arguments, and the template can be tested locally with a real `data.json`. **Chosen.**
