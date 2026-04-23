# urban-subagents

Cross-provider sub-agent broker for Claude Code and Codex.

## Canonical Spec

[IMPLEMENTATION_PLAN.md](D:/Working/urban-subagents/IMPLEMENTATION_PLAN.md) is the authoritative implementation spec and source of truth.

## Recommended Install

Use the npm bootstrap flow:

```bash
npx --yes urban-subagents@latest install --host all --force
```

What this does:

- installs or upgrades `urban-subagents` globally with `npm install -g`
- re-executes the installed broker, not the transient `npx` copy
- runs `agent-broker init`
- runs `agent-broker doctor --verbose`

The generated Claude and Codex host config points at the persistent installed broker, not repo-local `tsx` paths and not `npx`.

## GitHub Release Install

The bootstrap command can also promote itself from a GitHub tarball or git spec instead of the npm registry.

GitHub release tarball:

```bash
npx --yes --package=https://github.com/YOUR_USER/urban-subagents/releases/download/v0.1.0/urban-subagents-0.1.0.tgz agent-broker install --host all --force
```

GitHub repo spec:

```bash
npx --yes --package=github:YOUR_USER/urban-subagents agent-broker install --host all --force
```

If you need to override the detected bootstrap source manually, use:

```bash
agent-broker install --package-spec <npm|git|tarball spec> --host all --force
```

## Release Automation

Tagged releases now publish automatically through GitHub Actions using npm trusted publishing (OIDC), not an `NPM_TOKEN`.

Required setup:

- set `package.json.repository` to the public GitHub repo URL before relying on npm provenance
- push a tag that matches `package.json`, for example `v0.1.0`
- configure npm trusted publishing for the package and this exact workflow file: `.github/workflows/release.yml`

What the release workflow does on `v*` tags:

- verifies the tag version matches `package.json`
- runs `npm ci`
- runs `npm run check`
- runs `npm test`
- runs `npm run build`
- creates an npm tarball
- publishes to npm with provenance
- creates a GitHub Release and attaches the `.tgz`

### First Publish Bootstrap

npm currently requires the package to already exist before you can configure a trusted publisher for it.

That means the first release is a one-time bootstrap:

1. Publish `urban-subagents` manually from your local machine:

```bash
npm login
npm publish --access public
```

2. Configure trusted publishing for the existing package, either in the npm web UI or with the npm CLI:

```bash
npm trust github urban-subagents --repo YOUR_USER/urban-subagents --file release.yml
```

3. After trusted publishing is working, use release tags for future publishes:

```bash
git tag v0.1.1
git push origin v0.1.1
```

After that bootstrap publish, you no longer need a long-lived publish token for GitHub Actions.

## Core Commands

```bash
agent-broker install [--host all|claude|codex] [--force] [--skip-doctor] [--json]
agent-broker init [--host all|claude|codex] [--dry-run] [--force] [--json]
agent-broker doctor [--host all|claude|codex] [--verbose] [--fix] [--json]
agent-broker agents list
agent-broker sessions list [--scope current|all]
agent-broker delegate --agent NAME --prompt TEXT [--session SESSION_ID] [--cwd DIR]
agent-broker cancel --session SESSION_ID [--reason TEXT]
agent-broker reset --force
agent-broker serve-mcp --host-runtime <claude|codex>
```

## Development

For local repo testing, source-mode commands still work:

```bash
npm install
npm run build
npm run check
npm test
npm run test:acceptance
node node_modules/tsx/dist/cli.mjs src/cli/index.ts init --host all --force
```

Source-mode `init` intentionally keeps writing repo-local launchers so local development and manual testing stay easy. The `install` bootstrap path is what switches host config over to the persistent installed broker.
