# Development

## Commit Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification for all commits.

### Format

```
<type>[optional scope]: <description>


[optional body]

[optional footer(s)]
```

### Types

- `feat` -- A new feature
- `fix` -- A bug fix
- `chore` -- Maintenance tasks or dependency updates.
- `docs` -- Documentation changes
- `meta` -- Meta Changes 

### Scopes

- `frontend` -- Changes to frontend (below `assets/`)
- `backend` -- Changes to backend (below `src/`)

## Helpful Scripts

- **`scripts/deploy.sh`** -- 
  Builds a release binary and deploys it to [`2pc.dacsbund.de`](https://2pc.dacsbund.de). 
- **`scripts/live-build.sh`** -- 
  Runs `esbuild` in watch mode to continuously rebuild the frontend TypeScript (`assets/app.ts`) during development.
  These changes are automatically picked up by the backend when built with debugging.

## Testing

Frontend tests use [Vitest](https://vitest.dev/) and live under `assets/__tests__/`.

```bash
npm install           # install test dependencies (first time only)
npm test              # run all tests once
npm run test:watch    # run tests in watch mode
```

## AI Policy

Please read [AI_POLICY.md](AI_POLICY.md) before contributing.
We ask that you mention any AI used in your commit messages.
