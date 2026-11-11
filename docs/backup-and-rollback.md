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

Cloudflare releases use reviewed `drizzle/*.sql` filenames recorded in `d1_migrations`. The appended Drizzle journal/snapshots describe the existing auth schema and library changes for future code generation; they do not prove which migrations are pending or applied on a deployed instance. Sites internal migration bookkeeping is not exposed by the row viewer: adding `0001_auth` to the journal must never be treated as proof that its CREATE TABLE statements are pending. Keep historical SQL unchanged, take a complete encrypted backup, rehearse the additive delta and previous-code compatibility on an isolated restored database, and inspect the native publication result before retrying a failed migration. A code rollback is separate from database recovery. `content_search` and its triggers remain custom SQL rather than generated ordinary Drizzle tables. Historical SQL and the original snapshot remain unchanged; temporary regeneration produced no schema changes.

中文：Cloudflare 以实际 `d1_migrations` 文件名记录为准；新增 journal 不代表线上需要重跑历史 SQL。Sites 的内部迁移记录和数据库恢复路径必须先核实，不能盲目重跑已存在的认证表。搜索虚表及触发器是手工 SQL，后续生成迁移必须人工检查。

## Lossless encrypted recovery export

The ordinary reading archive excludes credentials and may normalize text; use the separate recovery tools for a complete database recovery copy. `scripts/collect-recovery.mjs` accepts reviewed configuration only through hidden stdin. On an owner-private Sites instance, an explicitly provisioned `PRIVATE_BACKUP_GRANT` enables a read-only maintenance export for at most two hours. The Site's platform access gate remains in place. No owner identity header is forged, and no arbitrary SQL or database write endpoint is exposed. Without this separate grant the service is disabled; hosted and standalone modes cannot enable it.

The collector reads complete rows twice, rejects truncation or mismatched user-data hashes, obtains the original runtime encryption key only in a recipient-encrypted envelope, and seals the snapshot under an independent backup key. It immediately restores the archive into an isolated in-memory database and verifies hashes and saved-key decryption without calling providers. Only encrypted data, a separate decryption-key file and a non-secret verification report are written outside Git with owner-only permissions. Keep the backup and its decryption key separately; neither belongs in the source repository. After maintenance, explicitly set the temporary grant to `revoked` and the write-pause flag to `false`, publish the environment revision, and verify that both backup endpoints return 401. Removing configuration keys alone did not immediately revoke the capability in one live publication; do not assume that a removed settings entry proves a runtime secret was invalidated. A successful offline restore proves recovery data, not a built-in platform database-restore service.

中文：源码、完整数据备份和解密文件分开保管。维护导出使用额外的限时凭据和原平台私有访问保护，不伪造用户身份。长正文、原内容 ID、收藏关联、配置密文和原加密主密钥均可包含在加密备份中；主密钥只以接收者加密信封传输。恢复验证在隔离数据库执行，不修改生产数据、不调用 AI。备份文件和独立解密文件都不能提交 Git。
