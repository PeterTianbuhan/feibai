# 飞白

一个单键游戏：笔锋绕着一个点转，点一下离手，飞进下一个圈。一圈一圈跳出去，探索几个画法不同的世界。

名字是 Peter 定的：飞白是书法里墨干时露出纸的笔画，也和 Fable 谐音。目录和包名暂时还叫 `yibi`。

要做成什么见 `docs/design.md`，规矩见 `AGENTS.md`。

## 命令

```sh
npm install
npm run dev      # 本地打开。?world=<id> 直接进某个世界，?level=0/1/2 选难度
npm run check    # 类型检查 + 测试 + 构建，提交前要过
npm run bot      # 试玩机器人：每个世界、三档难度、每条路的通过率
npm run shots    # 截图：每个世界五个固定时刻，手机和电脑各一张，放进 shots-out/
```

### 试玩机器人

它按「离手时机带误差的人」来玩：落进一个圈后缓一下，等下一个能落进目标的时间窗，瞄着窗的正中离手，
离手的时刻带正态分布的误差（默认标准差 40 毫秒）。每条路跑 400 趟，报整条路一次不失手走完的比例，
和每一跳的通过率、时间窗有多宽。走不通的路会说是够不着、资源撑不到，还是看不见下一个点。

```sh
npm run bot -- --world ink --level 中          # 只看一个世界的一档
npm run bot -- --world ink --route hill --hops  # 一条路上每一跳的数字
npm run bot -- --sigma 25 --runs 2000           # 手更稳的人，多跑几趟
npm run bot -- --help
```

种子定了结果就定了，改布局或手感数值之前和之后各跑一遍，数字可以直接比。

### 截图

```sh
npm run shots -- --world ink          # 只截一个世界
npm run shots -- --shot end --level 快
npm run shots -- --help
```

五个时刻：`title` 标题、`play` 途中、`sight` 到达一处景、`end` 结束那幅画、`map` 地图。
同一个时刻每次截出来是一样的。截完还会不走截图模式真按几下键，查页面有没有报错。
要用到浏览器：先试 playwright 自带的（`npx playwright install chromium`），没有就用系统里的 Chrome。

## 目录

- `src/core/` 规则和运动，不碰页面。手感数值在 `feel.ts`，世界的接口在 `world.ts`
- `src/worlds/<名字>/` 一个世界一个目录。`links.ts` 是世界之间的渡口
- `src/ui/` 外壳：循环、输入、镜头、标题、地图、结束画面、存档。世界画法的接口在 `look.ts`
- `tools/` 试玩机器人、截图
- `tests/` 测试。`fake/` 里是两个只给测试用的假世界
- `studies/<名字>/` 某个世界的画法试样，独立页面，不进游戏
- `prototype/index.html` 最早的单文件版，双击能玩，只作参考
- `docs/design.md` Peter 定下的设计

## 加一个世界

在 `src/worlds/<名字>/` 里放两个文件，不用到别处登记：

- `rules.ts` 导出 `rules`（`src/core/world.ts` 的 `WorldRules`）：资源、环境机制、布局、景、奖励。
- `look.ts` 导出 `look`（`src/ui/look.ts` 的 `WorldLook`）：底和笔、声音、结束画面。

然后 `npm run check` 会查它合不合格，`npm run bot -- --world <名字>` 报每条路的通过率，
`npm run shots -- --world <名字>` 出截图，`npm run dev` 打开 `?world=<名字>` 就能玩。
水墨（`src/worlds/ink/`）是完整的例子，`tests/fake/` 里两个假世界是规则那一半最短的例子。
