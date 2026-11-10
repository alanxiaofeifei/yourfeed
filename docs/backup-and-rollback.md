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
