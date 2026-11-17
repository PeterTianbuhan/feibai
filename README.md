# 飞白

一个单键游戏：笔锋绕着一个点转，点一下离手，飞进下一个圈。一圈一圈跳出去，探索几个画法不同的世界。

名字是 Peter 定的：飞白是书法里墨干时露出纸的笔画，也和 Fable 谐音。目录和包名暂时还叫 `yibi`。

要做成什么见 `docs/design.md`，规矩见 `AGENTS.md`。

## 命令

```sh
npm install
npm run dev      # 本地打开
npm run check    # 类型检查 + 测试 + 构建，提交前要过
```

## 目录

- `src/core/` 规则和运动，不碰页面
- `src/worlds/<名字>/` 一个世界一个目录
- `src/ui/` 标题、地图、见闻册、结束画面
- `tools/` 试玩机器人、截图
- `studies/<名字>/` 某个世界的画法试样，独立页面，不进游戏
- `prototype/index.html` 最早的单文件版，双击能玩，只作参考
- `docs/design.md` Peter 定下的设计
