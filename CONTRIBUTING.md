# Contributing

## Changelog and version policy

用户可见行为、公开 API、错误契约、配置、CLI 参数或迁移方式发生变化时，应在同一 PR 更新根目录 `CHANGELOG.md` 的 `Unreleased` 部分。

版本 PR 必须同时完成：

1. 修改目标包的 `package.json` 版本。
2. 将该包待发布内容从 `Unreleased` 移到正式标题：

   ```text
   ## [@scope/package@1.2.3] - YYYY-MM-DD
   ```

3. 一个 PR 修改多个包版本时，为每个包添加独立标题。
4. 在 PR 描述中说明 breaking change 和迁移方式。

CI 的 `Version changelog` job 会比较 PR base 和 HEAD；检测到版本变化但缺少对应正式条目时直接失败。

发布脚本不会自动 bump 或临时修改 `package.json`。本地版本必须高于 npm 远程版本，并且已有匹配的正式 changelog 条目，才能发布。
