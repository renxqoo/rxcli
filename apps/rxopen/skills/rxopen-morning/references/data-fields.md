# 晨报编排:各数据源的返回字段速查

编排晨报时,agent 需要从 5 个命令的返回里精确提取字段。这份是字段速查,避免猜字段名。

## life weather —— 天气

```bash
rxopen life weather <城市> --json
```

关键字段(在 `data` 下):
- `location` —— 识别出的地点(确认城市对不对)
- `weather.condition` —— 天气状况(晴/多云/雷阵雨...)
- `weather.temperature` —— 当前温度(℃)
- `weather.humidity` —— 湿度(%)
- `weather.wind_direction` / `weather.wind_power` —— 风向风力
- `air_quality.aqi` / `air_quality.quality` —— 空气质量指数 + 等级(优/良/轻度污染...)
- `air_quality.pm25` / `air_quality.pm10` —— 颗粒物
- `alerts[]` —— 预警数组(暴雨/高温/台风等),每项含 `title`、`level`、`type`
- `sunrise` —— 日出日落(可算"今天还亮多久")

**推理规则**(agent 基于这些字段做建议,不是硬编码):
- 温度 ≥ 30° → "注意防暑,多喝水"
- 温度 ≤ 10° → "注意保暖"
- `condition` 含 雨/雪 → "⚠️ 带伞"
- `condition` 含 雷暴 → "⚠️ 减少户外活动"
- AQI > 150 → "😷 空气差,建议戴口罩"
- `alerts` 非空 → 列出预警级别和类型
- 风力 ≥ 6 级 → "大风,注意高空物品"

## daily —— 每日新闻

```bash
rxopen daily --json
```

关键字段:
- `date` —— 日期(确认是今天的数据)
- `news` —— **string[]**(标题数组,不是对象数组!)。直接取字符串当谈资标题。
- `tip` —— 每日微语(可做结尾点缀)
- `day_of_week` / `lunar_date` —— 星期 + 农历(简报头部用)

**注意**:`news` 是 `string[]`,不是 `[{title}]`。直接 `news[0]` 就是第一条标题。

## moyu —— 打工日历

```bash
rxopen moyu --json
```

关键字段:
- `today.isWeekend` / `today.isWorkday` —— 今天是否周末/工作日
- `today.holidayName` —— 如果今天是节假日,叫什么
- `countdown.toWeekEnd` —— 距周末几天
- `countdown.toFriday` —— 距周五几天
- `nextHoliday` —— 下个节假日(名称 + 日期)
- `nextWeekend` —— 下个周末
- `progress.week.percentage` / `progress.month.percentage` —— 本周/本月进度

## life lunar —— 老黄历

```bash
rxopen life lunar --json
```

关键字段(趣味点缀用):
- `solar` / `lunar` —— 公历/农历
- `zodiac` —— 生肖
- `constellation` —— 星座
- `taboo.day.recommends[]` —— 今日宜(字符串数组)
- `taboo.day.avoids[]` —— 今日忌(字符串数组)
- `fortune.today_luck` / `fortune.career` / `fortune.money` / `fortune.love` —— 运势(趣味用)

**注意**:宜忌是趣味点缀,渲染时用轻松口吻,挑生活相关的(出行/约饭/搬家),跳过太古老/不适用的(祭祀/冠笄)。

## life today-in-history —— 历史上的今天

```bash
rxopen life today-in-history --json
```

关键字段:
- `items[]` —— 事件数组,每项含:
  - `title` —— 事件
  - `year` —— 年份
  - `event_type` —— `birth` | `death` | `event`
  - `description` —— 描述(可截断)

**挑取规则**:优先科技/文化/体育类(有正面意义),避免大量伤亡/灾难类。挑 1 条最有趣的。

## 可选模块字段

### life fuel-price(有车用户)

```bash
rxopen life fuel-price --region <省> --json
```
- `region` —— 区域
- `items[]` —— 各油号价格(`name`、`price`、`price_desc`)
- `trend.direction` —— 下次调价方向(上调/下调/搁浅)

### life exchange-rate(海淘/出境用户)

```bash
rxopen life exchange-rate --currency <币种> --json
```
- `base_code` —— 基准币
- `rates[]` —— 汇率列表(`currency`、`rate`)
