# Stateless renderer: the caller sends the full template

Status: accepted

Each request carries the full Typst template and the data. docspawner stores no templates, versions, or documents. This keeps it horizontal: any team, service, or agent can use it with no setup, and docspawner has no database, auth, or migrations.

## Considered options

- **Template registry** (upload once, render by ID and version): smaller requests and a place for versioning, but it adds storage, auth, and a lifecycle to manage. It also makes docspawner the owner of other teams' templates.
- **Stateless** (template in every request): **chosen**.

## Consequences

- The caller owns template storage and versioning, for example in its own Git repo.
- Requests are larger. The HTTP body limit is 8 MB.
- A registry can be added later as a separate service in front of docspawner, with no change to the core.
