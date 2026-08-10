# tool —— 开发者工具

`rxopen tool` 提供翻译、哈希、二维码、密码、域名、IP 等开发工具。

## tool fanyi —— 有道翻译

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `<text>`(位置参数) | string | 是 | — | 待翻译文本 |
| `--from` | string | 否 | auto | 源语言代码(见 fanyi-langs) |
| `--to` | string | 否 | auto | 目标语言代码 |

返回:`{source:{text, type, type_desc, pronounce}, target:{text, type, type_desc, pronounce}}`。语言无效返回 `invalid_argument`;翻译异常返回 `server_error`。

常用语言代码:`zh-CHS`(中文)、`en`(英语)、`ja`(日语)、`ko`(韩语)、`fr`(法语)、`de`(德语)、`ru`(俄语)、`es`(西班牙语)。完整列表用 `tool fanyi-langs`。

## tool fanyi-langs —— 翻译支持语言

无参数。返回数组:`[{label(中文名), code(语言代码), alphabet}]`,按字母排序。

## tool hash —— Hash & 编码转换

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | :--: | --- |
| `<content>`(位置参数) | string | 是 | 待处理内容 |

返回:`{source, md5, sha:{sha1,sha256,sha512}, base64:{encoded,decoded}, url:{encoded,decoded}, gzip:{...}, deflate:{...}, brotli:{...}}`。

## tool qrcode —— 二维码生成

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `<text>`(位置参数) | string | 是 | — | 要编码的文本 |
| `--size` | number | 否 | 256 | 图片尺寸 px |
| `--level` | string | 否 | M | 纠错级别 L/M/Q/H |

返回:`{text, base64, data_uri}`(base64 不含 data: 前缀;data_uri 可直接用于 img src)。CLI 不直接产图片二进制,用 data_uri 字段。

## tool og —— Open Graph 解析

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | :--: | --- |
| `<url>`(位置参数) | string | 是 | 目标 URL(无协议头自动补 https://) |

返回:`{title, image, description}`。非 HTML/无效 URL 返回错误。

## tool whois —— 域名 WHOIS

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | :--: | --- |
| `<domain>`(位置参数) | string | 是 | 域名(可含子域/协议头,自动提取根域,支持中文域名) |

返回:`{domain, unicode_domain, punycode_domain, status[], registrar, registrant:{...}, nameservers[], created, updated, expires, duration_desc}`(缓存 5 分钟)。未注册返回 `invalid_argument`。

## tool ip —— IP 地址查询

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--ip` | string | 否 | 调用者公网 IP | 指定 IP |

返回:`{ip, continent, country, isp, prov, city, lat, lng, timezone, ...}`(部分字段可能为空,取决于数据源)。

## tool password —— 随机密码生成

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `--length` | number | 16 | 密码长度(4-128) |
| `--numbers` | boolean | 开 | 包含数字(false/0 关) |
| `--symbols` | boolean | 关 | 包含特殊符号(true/1 开) |
| `--lowercase` / `--uppercase` | boolean | 开 | 包含小写/大写字母 |
| `--excludeSimilar` | boolean | 开 | 排除相似字符 il1Lo0O |
| `--excludeAmbiguous` | boolean | 开 | 排除模糊字符 {}[]()/等 |

返回:`{password, length, config, character_sets, generation_info:{entropy, strength, time_to_crack}}`。

## tool password-check —— 密码强度检测

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | :--: | --- |
| `<password>`(位置参数) | string | 是 | 待检测密码(≤128) |

返回:`{password, length, score(0-100), strength(极弱/弱/中等/强/极强), entropy, time_to_crack, character_analysis, recommendations[], security_tips[]}`。

## tool color —— 颜色信息

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--color` | string | 否 | 随机 | HEX 颜色(如 #FF5733) |

返回:`{hex, name(色系), rgb, hsl, hsv, cmyk, lab, brightness, contrast, accessibility:{aa_normal, best_text_color, ...}, complementary, analogous[], triadic[]}`。

## tool color-palette —— 配色方案

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--color` | string | 否 | 随机 | 基础 HEX 颜色 |

返回:`{input, palettes:[{name, description, colors:[{hex, role, theory}]}], metadata}`(含单色/互补/邻近/三角/分裂互补/四边形/Web设计等方案)。

## tool chemical —— 化学物质信息

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | :--: | --- | --- |
| `--id` | string | 否 | 随机 | ChemSpider ID |

返回:`{id, name, mass, formula, image(结构式图 URL), monoisotopicMass}`。
