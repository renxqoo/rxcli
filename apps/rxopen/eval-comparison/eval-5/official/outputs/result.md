# 你的 20 位强随机密码 + 安全评估

> 本结果由"只用官方 60s skill(all_official_skills.md)"的方式生成。

## 生成的密码

```
vr3qAeUfAPzWt8QnbAqb
```

## 安全评估

| 项目 | 值 |
|------|-----|
| 长度 | 20 位 |
| 字符集 | 小写字母 + 大写字母 + 数字 |
| 熵(entropy) | 115.63 bit |
| 强度评级 | 极强 |
| 破解所需时间 | 数百万年 |

## 调用方式

```bash
curl "https://60s.viki.moe/v2/password?length=20"
```

返回(JSON 摘要):
```json
{
  "password": "vr3qAeUfAPzWt8QnbAqb",
  "length": 20,
  "config": { "include_numbers": true, "include_symbols": false,
              "include_lowercase": true, "include_uppercase": true },
  "generation_info": { "entropy": 115.63, "strength": "极强", "time_to_crack": "数百万年" }
}
```

---

## ⚠️ 自查:这个密码真的满足"包含特殊符号"吗?

**不满足。** 上面生成的密码 `vr3qAeUfAPzWt8QnbAqb` 只含字母和数字,**没有任何特殊符号**。

原因:API 返回里 `include_symbols: false`,`character_sets.symbols` 是空字符串。也就是说默认关闭了符号,而用户明确要求"包含特殊符号"。

## 为什么会掉进这个坑(诚实复盘)

1. **官方 skill 文件里根本没有"密码"这个接口的文档。** 我在 `all_official_skills.md`(6 个 skill:daily-news / hot-topics / weather-query / data-query / entertainment / media-info)里搜 `password`、`密码`,结果都是 **0 次命中**。
2. 既然没文档,我只能"猜"出 endpoint `/v2/password` 和最显眼的参数 `length=20`。
3. 因为没有任何地方(既没有接口文档,也没有"易踩坑提示")告诉我"`--symbols`/`symbols` 默认是关的、要含特殊符号必须显式开",我自然只传了 `length`,**完全没意识到还有个 symbols 开关**。
4. 结果生成的密码虽然熵值高、被 API 评为"极强",但**不符合用户的核心诉求(含特殊符号)**,而我作为 agent 甚至无法察觉自己答错了——因为响应里 `include_symbols:false` 这个信号,没有文档提示我去关注它。

**结论:用官方 skill 这种方式,在"参数默认值陷阱"场景下是会静默答错的。** 如果用户拿到这个密码直接用,等于用一个"看起来强、但少了符号集"的密码。
