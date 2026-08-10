# 热搜编排:各平台返回字段差异

交叉验证时,各平台的返回字段略有差异。这里列出每平台的核心字段,供归纳"讨论角度差异"时用。

## 通用核心字段

所有平台都有:
- `title` —— 热搜标题/话题(语义去重的主依据)
- `link` / `url` —— 详情链接

## 各平台特有字段(辅助判断讨论角度)

### 微博 weibo
```
{ title, hot_value, link }
```
- `hot_value` —— 热度数值(数字,越高越火)
- 已过滤推广内容
- **讨论特征**:情绪化、当事人回应、吃瓜、转发求助

### 知乎 zhihu
```
{ title, detail, cover, hot_value_desc, answer_cnt, follower_cnt, comment_cnt, created_at, link }
```
- `detail` —— 问题描述/摘要(可用来判断讨论深度)
- `answer_cnt` —— 回答数(判断讨论热度)
- `follower_cnt` —— 关注数
- **讨论特征**:深度分析、专业人士解读、争议探讨

### 头条 toutiao
```
{ title, hot_value, cover, link }
```
- `hot_value` —— 热度
- **讨论特征**:新闻资讯、官方报道、大众传播

### 抖音 douyin
```
{ title, hot_value, cover, link, event_time }
```
- `hot_value` —— 热度
- `event_time` —— ⚠️ 上游时间戳可能不准,别依赖
- **讨论特征**:二创、玩梗、视觉传播、口语化标题

### B站 bili
```
{ title, link }
```
- 字段最少,只有 title + link
- 已过滤商业推广
- **讨论特征**:吐槽、鬼畜、深度视频、二次元

### 小红书 rednote
```
{ rank, title, score, word_type, link }
```
- `rank` —— 排名
- `score` —— 热度分
- `word_type` —— 话题类型
- **讨论特征**:穿搭模仿、生活方式、种草/避雷、消费决策

### 百度热搜 baidu-hot
```
{ rank, title, desc, score, score_desc, cover, type_desc, url }
```
- `rank` —— 排名
- `desc` —— 描述(可判断内容性质)
- `type_desc` —— "新"/"热"/null(标签)
- **讨论特征**:新闻资讯、搜索热度驱动、含部分商业词条

### 懂车帝 dongchedi
```
{ rank, title, url, score, score_desc }
```
- 垂直平台,主要是汽车话题
- **讨论特征**:新车发布、车型对比、汽车行业

### 夸克 quark
```
{ id, title, summary, source, cover, category[], like_count, link }
```
- `summary` —— 内容摘要(信息最全)
- `source` —— 来源
- `category[]` —— 分类
- **讨论特征**:聚合新闻、地方热点、多元话题

## 交叉验证技巧

1. **以 title 为主做语义去重**,`detail`/`summary`/`desc` 辅助判断是否同一事件。
2. **热度值不可跨平台比**:微博 hot_value 和抖音 hot_value 量级不同,只比"命中平台数",不比绝对热度。
3. **判断讨论角度**:看平台调性(上面每平台的"讨论特征")+ 该话题在该平台的 title 措辞(知乎用问句、抖音用感叹号/口语)。
4. **垂直平台独有话题不算"偏差"**:懂车帝的车话题、小红书的消费话题,本来就垂直,单平台命中是正常的,不要误判为"水军"。
