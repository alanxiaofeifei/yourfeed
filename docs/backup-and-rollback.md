# Backup and rollback / 备份与回滚

Before accepting an update, preserve the previous Git commit, deployed Worker version, migration list, D1 backup and encryption key. Record them in your private operations notes, never in the public core repository.

```sh
# Review the configured account and D1 database first.
npx wrangler d1 export DB --remote --output ./private-backups/yourfeed-before-update.sql
```

Store this SQL outside Git, encrypted at rest. It contains private content, feedback, auth records and encrypted provider keys. Back up `APP_ENCRYPTION_KEY` separately with appropriate access controls; a database backup without that master key cannot recover saved provider credentials. Keep `AUTH_SECRET` private too. Add your backup directory to your private repository’s ignore rules.

Apply migrations only after reviewing the PR and backup. Historical migration SQL and snapshots are immutable; new migrations must be additive and forward-compatible with the previous code where possible. Review table drops, column changes and data transformations manually.

For a code-only regression, use Cloudflare’s **Deployments → Roll back** or `wrangler rollback` to a known version and revert the corresponding Git commit. **A Worker rollback does not revert D1 schema or data.** Avoid running older code against an incompatible new schema. Prefer a tested forward fix; for destructive data failures, restore into a separate D1 database first, validate it, and deliberately switch the private `DB` binding. D1 Time Travel is another recovery option within its retention window.

Sites deployments should retain their matching Git commit and Sites version in private release notes. Use the Sites version controls to restore code; database recovery is a separate operation.

中文：先备份数据库和加密主密钥，再迁移。数据库导出不可提交 Git。代码回滚不会撤销数据库变化；需要恢复数据时先恢复到另一个数据库并验证，再有意识地切换绑定。不要随意重新生成加密主密钥。

References: [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Workers rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).


## Release checklist and native Sites gate

For **each** production instance, verify the exact Worker/Site, actual DB binding, full migration list and schema, source SHA, previous code deployment and a tested recovery route before any migration. Check schema independently of migration bookkeeping. Authentication and source data must not be inferred from an HTTP 200 health response.

Record private before/after counts or hashes for stable source/content IDs, feedback ownership and settings keys. Verify saved credential decryption locally as a boolean without calling a paid provider; preserve the original encryption key and namespace. Do not copy ciphertext or personal identifiers into public release logs.

For an existing Sites app, keep its original project ID, logical `DB` binding, access policy, trusted platform user ID, `AUTH_MODE=sites` and secret namespace. Native Sites code rollback still does not roll back its DB. If the supported Sites DB export/recovery mechanism is not available or cannot be verified, **block schema-changing publication** and complete recovery discovery first. Do not reinitialize, reseed or substitute a newly created Site for the original private one.

Additive schema changes should remain compatible with the previous code. Data backfills must be resumable, preserve IDs and user changes, and store a checkpoint. A failed deployment may have applied schema migrations already. Destructive changes, ID remapping and key rotation require a separate reviewed operation.

Deleting active rows does not imply immediate permanent erasure from database recovery points, logs, exported backups or browser downloads. State each retention period separately. Test fixtures and acceptance accounts must stay in isolated test resources, never be recreated automatically in an existing production instance.

中文：每个实例上线前都要核对目标、数据库、完整结构与迁移、备份和恢复方法。AlanFeed 保留原 Site、用户 ID、命名空间、主密钥、来源和反馈关联。拿不到可验证的 Sites 数据库恢复通道时，不能发布结构变更。清空当前数据不代表备份和日志立即消失。

## Migration authority

Cloudflare releases use reviewed `drizzle/*.sql` filenames recorded in `d1_migrations`. The appended Drizzle journal/snapshots describe the existing auth schema and library changes for future code generation; they do not prove which migrations are pending or applied on a deployed instance. Existing Sites internal migration history is unverified: adding `0001_auth` to the journal must never cause blind replay of its CREATE TABLE statements. AlanFeed schema publication remains blocked until actual platform history and a supported recovery path are verified. `content_search` and its triggers remain custom SQL rather than generated ordinary Drizzle tables. Historical SQL and the original snapshot remain unchanged; temporary regeneration produced no schema changes.

中文：Cloudflare 以实际 `d1_migrations` 文件名记录为准；新增 journal 不代表线上需要重跑历史 SQL。Sites 的内部迁移记录和数据库恢复路径必须先核实，不能盲目重跑已存在的认证表。搜索虚表及触发器是手工 SQL，后续生成迁移必须人工检查。
