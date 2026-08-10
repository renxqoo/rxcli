# 晨报字段

所有命令都加 `--json`，字段位于顶层 `data`。

## 实时天气

```bash
rxopen life weather <城市> --json
```

- `location`:识别地点。
- `weather.condition`、`weather.temperature`、`weather.humidity`、`weather.wind_direction`、`weather.wind_power`:当前天气。
- `air_quality.aqi`、`air_quality.quality`:空气质量；对象可能为 `null`。
- `alerts[]`:天气预警；数组可能为空。

## 当日预报

```bash
rxopen life forecast <城市> --days 1 --json
```

- `daily_forecast[0].day_condition`、`night_condition`:白天和夜间天气。
- `daily_forecast[0].max_temperature`、`min_temperature`:最高和最低温。
- `daily_forecast[0].day_wind_power`、`night_wind_power`:日夜风力。
- `hourly_forecast[]`:近期逐小时温度和天气，可用于判断稍后降水；不要超出返回时段推断。

只有实时或预报字段包含雨、雪、雷暴时才提醒携带雨具；预警非空时优先展示预警。空气质量字段缺失时不提供口罩建议。

## 每日新闻

```bash
rxopen daily --json
```

- `date`:实际新闻日期；可能早于请求日期。
- `news`:标题字符串数组，不是对象数组。
- `day_of_week`、`lunar_date`:简报日期信息。
- `tip`:可选结尾短句。

## 打工日历

```bash
rxopen moyu --json
```

- `today.isWeekend`、`today.isWorkday`、`today.holidayName`:当天状态。
- `countdown.toWeekEnd`、`countdown.toFriday`:周末倒计时。
- `nextHoliday`:下个节假日，可能为 `null`。
- `progress.week.percentage`:本周进度。

## 可选信息

```bash
rxopen life lunar --json
rxopen life today-in-history --json
```

- 黄历:`taboo.day.recommends[]`、`taboo.day.avoids[]`，只作趣味展示。
- 历史事件:`items[]`，每项含 `title`、`year`、`event_type`、`description`。
