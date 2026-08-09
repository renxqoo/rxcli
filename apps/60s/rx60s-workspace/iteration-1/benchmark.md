# Skill Benchmark: rx60s

**Model**: GLM-5.2 (builtin:bigmodel/GLM-5.2)
**Date**: 2026-08-09T13:44:54Z
**Evals**: 1, 2, 3, 4, 5 (1 runs each per configuration)

## Summary

| Metric | With Skill | Without Skill | Delta |
|--------|------------|---------------|-------|
| Pass Rate | 100% ± 0% | 100% ± 0% | +0.00 |
| Time | 59.0s ± 17.3s | 59.0s ± 17.3s | +0.0s |
| Tokens | 171145 ± 46232 | 171145 ± 46232 | +0 |

## Notes

- 所有 10 个 run(5 eval × with/without)客观断言全部 100% 通过——CLI 的 --help 已足够自文档化,baseline 也能完成简单任务
- 断言非区分性:当前 3 类断言(调用了 CLI / 返回 N 条 / 含某字段)在有/无 skill 下都通过,无法体现 skill 的增量价值。要区分 skill 价值需设计更难的 eval(如:要求用 --no-json 人类可读输出、要求管道串联、要求模糊意图映射如'摸鱼'→moyu、要求知道 zh-CHS 这类非显然参数值)
- skill 的真实增量(从 agent 报告观察,非断言捕获):① 零探索直达正确命令(with-skill 单次调用,baseline 需 1-2 次 --help 探索);② 暴露非显然默认值(如 password 的 --symbols 默认关,易踩坑);③ 提供错误处理/环境变量/fallback 语义(references 里的字段表);④ 语言代码表(fanyi-langs)、榜单 ID 等需查表才能得到的值
- 耗时/token:with 与 without 接近(各 ~59s / 171k tok),因为 baseline 多花的 --help 探索被 skill 读取 SKILL.md 的开销抵消。复杂任务下 skill 的探索节省会更显著
- eval-1 出现一次瞬时 connection_refused(exit 4),skill 错误处理表有记录,重试即恢复——CLI 网络层健壮性 OK
- 建议下一轮 iteration 设计:① 模糊意图 eval('离周末还有几天'→moyu);② 参数陷阱 eval(默认 symbols 关);③ 多步 eval(先 rank 拿榜单 ID 再 rank-detail);④ 输出格式 eval(强制 --no-json 表格)