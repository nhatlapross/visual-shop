# Notes for coding agents

- This is a **Vite + React** SPA, not Next.js. There is no server: data comes from Sui (gRPC via `@mysten/dapp-kit-react` 2.x; public fullnodes reject JSON-RPC, so do not use `SuiJsonRpcClient` or the old `@mysten/dapp-kit` hooks) and Walrus (HTTP).
- Read `docs/spec.md` and `docs/plan.md` before changing anything. Stay inside your lane's files; shared files are listed in the plan.
- All UI text is English.
- `src/lib/eyewear-3d/` is ported code with its own tests. Run `pnpm test` after touching it.
- `port/` holds unported source files and is excluded from `tsc`. Move a file to `src/` before using it.
- Before you call something done, run `pnpm build`, `pnpm test`, and `pnpm test:move` if you touched `move/`.
- Never commit secrets. `.env*` is git-ignored except `.env.example`. Public contract IDs live in `src/deployment.json`. Every `VITE_*` value ships to the browser, so private keys never belong there.
