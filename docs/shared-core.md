# Reviewed shared-core updates / 共享核心更新

The upstream is `alanxiaofeifei/yourfeed`. Consumers keep their own private settings and receive a **proposal PR**, never an automatic production update. The workflow resolves the latest non-prerelease GitHub release to a full immutable commit SHA, then runs every six hours or through **Actions → Propose shared core update → Run workflow**. It does not run on upstream itself. Enable Actions in your copied repository and allow GitHub Actions to create pull requests under repository settings.

## Initialize a consumer

Choose the exact upstream commit from which your instance was copied, then record that baseline:

```sh
node scripts/update-core.mjs --init --ref UPSTREAM_COMMIT_SHA
git add .yourfeed-core.json .yourfeed-sync.json scripts/update-core.mjs .github/workflows/core-update.yml
git commit -m 'chore: record reviewed YourFeed core baseline'
```

`--init` records upstream content hashes without modifying application files or dependencies. It must refer to the actual reviewed source version, not an arbitrary newer commit. Local differences are retained and will block an overlapping future change for manual review. The first update without a baseline can add missing files but refuses to overwrite differing existing files. Use `npm run core:update -- --dry-run` to inspect a proposal.

## Contract

Only these hard-coded groups can be selected by `.yourfeed-sync.json`: `server/**`, `shared/**`, `app/components/**`, `app/i18n.tsx`, the generic page/layout/styles, Worker entry, Vite/build adapter, `db/schema.ts`, `drizzle/**`, `tests/**`, the updater and its PR workflow. A consumer can narrow this list. The updater cannot widen it to personal files. No source deletions are propagated.

Protected: `data/**` (seed, sources and profile), `.env*`, `.dev.vars*`, `.openai/**`, `.wrangler/**`, deployment manifests, README and local sync configuration. Put private branding/profile overlays in `data/**`; generic UI and build adapters are shared. Only upstream dependency/devDependency entries merge into `package.json`; name, scripts, private flag, hosting settings and unrelated dependencies are preserved. Dependency source URLs are rejected. The workflow regenerates the lock file and runs checks.

Existing migration SQL and snapshots cannot change; a migration journal may only append entries. New migration files and `db/schema.ts` may enter the PR, but **nothing applies SQL to a database**. A changed local shared file is never overwritten when upstream also changed it: the entire proposal stops without writing tracked files. Resolve the diff manually, test it, and update the baseline only to the version actually reviewed. A public update may require private adapter changes; do not force-copy around a conflict.

The PR workflow checks types, tests and production build before opening or updating one branch. It has repository write permission solely to create that reviewable PR. It has no deployment secrets, no merge step and no deploy step. Review workflow changes and dependency changes as code before merging. If the proposal fails, inspect the Actions log and resolve explicitly; failure does not change the production site.

For an existing native Sites instance keep its real manifest, encryption secret, `AUTH_MODE=sites` and Sites build profile in its private repository/deployment. The updater preserves its package name and scripts. Keep `YOURFEED_BUILD_PROFILE=sites` in the consumer build script; shared Vite/build code supports that profile. Conflicting local adapter edits halt the proposal. Back up D1 before applying newly reviewed migrations; see [backup and rollback](backup-and-rollback.md).

中文：自动化只生成 PR，不合并、不部署、不执行迁移。`--init` 只记录你实际复制版本的哈希；本地定制和上游改动重叠时会停止，交给你人工处理。个人资料、数据库状态、真实 Sites ID、密钥和部署配置不在同步范围内。历史迁移不可改写。
