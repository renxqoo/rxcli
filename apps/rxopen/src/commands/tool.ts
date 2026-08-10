/**
 * tool —— 开发者工具
 *
 * 子命令:
 *   hash            Hash & 编码转换(MD5/SHA/Base64/URL/gzip/...)
 *   qrcode          二维码生成(返回 base64/data_uri)
 *   og              Open Graph 解析
 *   whois           域名 WHOIS 查询
 *   ip              IP 地址查询
 *   password        随机密码生成(含强度评估)
 *   password-check  密码强度检测
 *   color           颜色信息/格式转换(HEX/RGB/HSL/...)
 *   color-palette   配色方案生成
 *   chemical        化学物质信息(ChemSpider)
 *   fanyi           有道翻译
 *   fanyi-langs     有道翻译支持语言列表
 *
 * 注:hash/og/fanyi 上游是 ALL 路由(支持 POST + body);CLI 走 GET + query 即可。
 */

import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

export const toolCommands = defineCommands({
  hash: defineCommand<{ content: string }>({
    name: "hash",
    description: "Hash & 编码转换(MD5/SHA/Base64/URL/gzip/...)",
    args: { content: { type: "string", required: true, positional: true, desc: "待处理内容" } },
    async run({ content }, ctx) {
      const res = await ctx.get("/hash", withQuery({ content }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  qrcode: defineCommand<{ text: string; size?: number; level?: string }>({
    name: "qrcode",
    description: "二维码生成(返回 base64 / data_uri)",
    args: {
      text: { type: "string", required: true, positional: true, desc: "要编码的文本" },
      size: { type: "number", desc: "图片尺寸 px(默认 256)" },
      level: { type: "string", desc: "纠错级别 L/M/Q/H(默认 M)" },
    },
    async run({ text, size, level }, ctx) {
      const res = await ctx.get("/qrcode", withQuery({ text, size, level, type: undefined }));
      return { data: unwrap<{ text: string; base64: string; data_uri: string }>(res) };
    },
  }),

  og: defineCommand<{ url: string }>({
    name: "og",
    description: "Open Graph 信息解析(抓取网页 og:title/image/description)",
    args: {
      url: {
        type: "string",
        required: true,
        positional: true,
        desc: "目标 URL(无协议头自动补 https://)",
      },
    },
    async run({ url }, ctx) {
      const res = await ctx.get("/og", withQuery({ url }));
      return { data: unwrap<{ title: string; image: string; description: string }>(res) };
    },
  }),

  whois: defineCommand<{ domain: string }>({
    name: "whois",
    description: "域名 WHOIS 查询(注册信息,支持中文域名)",
    args: {
      domain: {
        type: "string",
        required: true,
        positional: true,
        desc: "域名(可含子域/协议头,自动提取根域)",
      },
    },
    async run({ domain }, ctx) {
      const res = await ctx.get("/whois", withQuery({ domain }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  ip: defineCommand<{ ip?: string }>({
    name: "ip",
    description: "IP 地址查询(归属/ISP/地理位置)",
    args: { ip: { type: "string", desc: "指定 IP(省略则查调用者公网 IP)" } },
    async run({ ip }, ctx) {
      const res = await ctx.get("/ip", withQuery({ ip }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  password: defineCommand<{
    length?: number;
    numbers?: boolean;
    symbols?: boolean;
    lowercase?: boolean;
    uppercase?: boolean;
    excludeSimilar?: boolean;
    excludeAmbiguous?: boolean;
  }>({
    name: "password",
    description: "随机密码生成(含熵/破解时间评估)",
    args: {
      length: { type: "number", desc: "密码长度(默认 16,范围 4-128)" },
      numbers: { type: "boolean", desc: "包含数字(默认开,false/0 关)" },
      symbols: { type: "boolean", desc: "包含特殊符号(默认关,true/1 开)" },
      lowercase: { type: "boolean", desc: "包含小写字母(默认开)" },
      uppercase: { type: "boolean", desc: "包含大写字母(默认开)" },
      excludeSimilar: { type: "boolean", desc: "排除相似字符 il1Lo0O(默认开)" },
      excludeAmbiguous: { type: "boolean", desc: "排除模糊字符 {}[]()/等(默认开)" },
    },
    async run(args, ctx) {
      const { length, numbers, symbols, lowercase, uppercase, excludeSimilar, excludeAmbiguous } =
        args;
      const res = await ctx.get(
        "/password",
        withQuery({
          length,
          numbers,
          symbols,
          lowercase,
          uppercase,
          exclude_similar: excludeSimilar,
          exclude_ambiguous: excludeAmbiguous,
        }),
      );
      return { data: unwrap<{ password: string; strength: string }>(res) };
    },
  }),

  "password-check": defineCommand<{ password: string }>({
    name: "password-check",
    description: "密码强度检测(熵/破解时间/改进建议)",
    args: {
      password: { type: "string", required: true, positional: true, desc: "待检测密码(≤128)" },
    },
    async run({ password }, ctx) {
      const res = await ctx.get("/password/check", withQuery({ password }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  color: defineCommand<{ color?: string }>({
    name: "color",
    description: "颜色信息/格式转换(HEX/RGB/HSL/HSV/CMYK/LAB + 无障碍对比度)",
    args: { color: { type: "string", desc: "HEX 颜色(如 #FF5733,省略随机)" } },
    async run({ color }, ctx) {
      const res = await ctx.get("/color/random", withQuery({ color }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  "color-palette": defineCommand<{ color?: string }>({
    name: "color-palette",
    description: "配色方案生成(单色/互补/邻近/三角/...)",
    args: { color: { type: "string", desc: "基础 HEX 颜色(省略随机)" } },
    async run({ color }, ctx) {
      const res = await ctx.get("/color/palette", withQuery({ color }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  chemical: defineCommand<{ id?: string }>({
    name: "chemical",
    description: "化学物质信息(分子式/分子量/结构式)",
    args: { id: { type: "string", desc: "ChemSpider ID(省略随机)" } },
    async run({ id }, ctx) {
      const res = await ctx.get("/chemical", withQuery({ id }));
      return { data: unwrap<unknown>(res) };
    },
  }),

  fanyi: defineCommand<{ text: string; from?: string; to?: string }>({
    name: "fanyi",
    description: "有道翻译",
    args: {
      text: { type: "string", required: true, positional: true, desc: "待翻译文本" },
      from: { type: "string", desc: "源语言代码(默认 auto,见 fanyi-langs)" },
      to: { type: "string", desc: "目标语言代码(默认 auto)" },
    },
    async run({ text, from, to }, ctx) {
      const res = await ctx.get("/fanyi", withQuery({ text, from, to }));
      return {
        data: unwrap<{
          source: { text: string; type_desc: string };
          target: { text: string; type_desc: string };
        }>(res),
      };
    },
  }),

  "fanyi-langs": defineCommand({
    name: "fanyi-langs",
    description: "有道翻译支持的语言列表",
    humanFormat(data) {
      return printTable(data as { label: string; code: string }[], [
        { header: "语言", value: (r) => r.label },
        { header: "代码", value: (r) => r.code },
      ]);
    },
    async run(_args, ctx) {
      const res = await ctx.get("/fanyi/langs", withQuery());
      const list = unwrap<unknown[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  }),
});
