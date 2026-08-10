# health —— 健康评估

## health assess —— BMI / 身体评估

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--height` | number | 是 | — | 身高 cm(50-300) |
| `--weight` | number | 是 | — | 体重 kg(10-300) |
| `--gender` | string | 是 | — | `male` \| `female` |
| `--age` | number | 是 | — | 年龄(1-150) |

返回:`{bmi, weight_assessment, metabolism:{bmr, tdee}, body_fat, health_advice, ideal_measurements, disclaimer}`。

注意:四个参数全必填,缺任何一个返回 `invalid_argument`。
