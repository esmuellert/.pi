# response-footer

一行统计，跟在每次回复下面，右对齐。

```
              1 tool  ·  39s  ·  $0.897  ·  cache 100%  ·  ↑1.7M ↓1.3k
           10 tools  ·  2m22s  ·  $4.58  ·  cache 100%  ·  ↑8.6M ↓9.4k
           36 tools  ·  4m37s  ·  $8.08  ·  cache 100%  ·  ↑15.1M ↓15k
```

窄了从尾部砍，前面的位置不动：

```
53 列
     1 tool  ·  39s  ·  $0.897  ·  cache 100%
```

看真实效果，不写盘：

```bash
node --experimental-strip-types mock/preview.ts
W=120 THEME=catppuccin-mocha node --experimental-strip-types mock/preview.ts
```

## 为什么是块外面的一行

pi 用内部组件渲染助手消息，扩展够不着。唯一能碰到那个块的是
`registerMarkdownTransformer`，但它只能改 markdown 源文本——加不了独立元素，
也控制不了颜色，而且拿不到是哪一条消息。

所以这行是一条独立的 `custom` 条目，追加在回复之后。`appendEntry` 把它写进
session 文件，`sessionEntryToContextMessages` 对 `custom` 类型返回空数组，所以
它重启后还在，也从不进模型的上下文。

## 一次回复是多个 turn

pi 每次模型调用发一对 `turn_start` / `turn_end`。一次回复在写这个扩展的会话里
中位跑 4 次，最多 113 次。所以统计从 `agent_start` 累到 `agent_end`，不是按
turn 算。

## 送入量算的是全部

`↑1.7M` 是这次回复送进去的全部 token，包含缓存命中的部分——整个上下文每轮都
要重发一遍。只报新增的会显示 8，而实际送了 170 万。

缓存命中率是把两者分开的那个数，也是账单波动的原因：72% 的回复命中 99% 以上，
掉下来的那些费用会跳几倍。

## 不回补

只对新产生的回合写条目。之前的回复没有这一行，文件不会被改写。

## 改动的后果

`ENTRY` 这个字符串（`"response-footer"`）读写两处共用一个常量。改了它，已经
写进文件的条目全部找不到渲染器 —— 不报错、不显示、留在文件里。

`data` 里的字段随便加减：渲染器逐个字段容错读取，缺了就少显示一项。pi 会把
抛异常的渲染器画成一个红色错误框，所以那里不能假设字段存在。
