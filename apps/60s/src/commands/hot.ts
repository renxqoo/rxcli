/**
 * hot —— 热搜榜单
 *
 * 子命令(各平台热搜榜,大多无参,返回数组):
 *   weibo / zhihu / toutiao / douyin / bili / rednote      社交平台热搜
 *   baidu-hot / baidu-teleplay / baidu-tieba               百度三榜
 *   dongchedi / quark                                       懂车帝 / 夸克热点
 *
 * 数据源:60s-api(/v2 前缀),多数支持 text/markdown(截前 20),CLI 走 json。
 */

import { defineCommands, defineCommand, printTable } from "@renxqoo/agent-data-cli";
import { unwrap, withQuery, countMeta } from "../envelope.js";

/** 通用热搜项(标题 + 热度 + 链接)。 */
interface HotItem {
  title: string;
  hot_value?: number;
  score?: number;
  link?: string;
  url?: string;
  cover?: string;
  [k: string]: unknown;
}

/** 生成一个无参热搜命令:GET 单路径,返回数组,表格渲染(标题 + 热度)。 */
function hotListCommand(name: string, path: string, desc: string) {
  return defineCommand({
    name,
    description: desc,
    humanFormat(data) {
      return printTable(data as HotItem[], [
        { header: "标题", value: (r: HotItem) => r.title },
        {
          header: "热度",
          value: (r: HotItem) => r.hot_value_desc ?? String(r.hot_value ?? r.score ?? ""),
          align: "right",
        },
      ]);
    },
    async run(ctx) {
      const res = await ctx.get(path, withQuery());
      const list = unwrap<HotItem[]>(res);
      return { data: list, meta: countMeta(list) };
    },
  });
}

export const hotCommands = defineCommands({
  weibo: hotListCommand("weibo", "/weibo", "微博实时热搜"),
  zhihu: hotListCommand("zhihu", "/zhihu", "知乎实时热搜"),
  toutiao: hotListCommand("toutiao", "/toutiao", "头条实时热搜"),
  douyin: hotListCommand("douyin", "/douyin", "抖音实时热搜"),
  bili: hotListCommand("bili", "/bili", "B 站实时热搜"),
  rednote: hotListCommand("rednote", "/rednote", "小红书实时热点"),
  "baidu-hot": hotListCommand("baidu-hot", "/baidu/hot", "百度实时热搜"),
  "baidu-teleplay": hotListCommand("baidu-teleplay", "/baidu/teleplay", "百度电视剧榜单"),
  "baidu-tieba": hotListCommand("baidu-tieba", "/baidu/tieba", "百度贴吧热门话题"),
  dongchedi: hotListCommand("dongchedi", "/dongchedi", "懂车帝热搜"),
  quark: hotListCommand("quark", "/quark", "夸克热点新闻"),
});
