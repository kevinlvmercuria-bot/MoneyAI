# NailMate 本地可维护性整理验收（2026-11-07）

## 改动与维护入口

- `public/workspace.js` 从约 1,230 行缩为约 480 行，保留初始化、导航、事件委托和保存协调。
- 六页渲染分别放入 `public/pages/{dashboard,members,care,studio,campaigns,reports}.js`；HTTP 请求在 `api.js`，共享状态在 `state.js`，展示组件在 `components.js`。
- `rules-client.js` 桥接原有共用规则；后端 CommonJS 导出不变。浏览器只暴露一份规则兼容对象，可变状态在模块内持有。11 个前端 ES 模块的本地引用完整、无循环依赖。
- 样式入口仍是 `public/styles.css`，按原顺序加载 `styles/base.css` 和 `styles/workspace.css`。两份内容拼接与原样式全文一致，未删除选择器。
- 正式启动为 `npm start` → `server/main.js`；`npm run dev` 监听同一入口。`server/index.js` 转发至该入口。旧内存实现、旧测试与旧初始化脚本仍有依赖，因此保留并标注用途，README 已说明。
- `scripts/check.js` 递归检查前端 ES 模块和后端 CommonJS 语法，package.json 的检查命令已同步。无新框架、构建工具或项目依赖。

## 实际验证

- 改动前、改动后均运行现有验收：`npm run check` 通过；`npm test` 正式 SQL Server 测试通过（TAP 统计 18 项，含父级）；`npm run test:legacy` 旧契约测试 2 项通过。
- 正式测试增加原生模块入口及新旧启动命令指向同一启动函数的断言。
- 使用安装的 Google Chrome 无头模式（Playwright 驱动），在独立随机 SQL Server 测试库中进行页面联调。使用项目提供的受控模型响应注入点，未请求真实模型。
- 六页分别在 1440×1000、390×844 视口与改动前页面对照。页面元素位置、尺寸、文本及所采集的计算样式一致，无横向溢出。12 组截图中 11 组像素完全一致；桌面驾驶舱仅 2 个像素的通道值相差 1，属于截图栅格化微差。
- Chrome 交互通过：跨页会员勾选、生成两条受控 AI 文案、编辑及预览、实际剪贴板内容、产品图片绑定上传与下载、审核修改批准、选择预约模拟情景、护理记录与跟进计划保存、复盘指标、刷新后文案/图片/护理记录保存。
- 浏览器未捕获到页面脚本错误。原始汇总见同目录 `maintainability-20261107-browser.json`，其中 `identical` 表示布局/样式一致且截图微差处于验收容差内，精确像素差见 `pixels` 和 `maxDifference`。
- 浏览器测试库在 finally 中清理；验收后查询确认没有遗留 `NailMate_Refactor_*` 数据库。已有业务数据库、来源数据、密钥与另一工作区未作修改。

## 验证边界

移动端为 Chrome 视口模拟，未使用真机或其他浏览器。本轮未重新调用真实 AI 提供方；AI 请求协议和响应处理保持原实现。六页外观和模块加载已实测，API 契约与数据库状态流转由原有自动化测试回归。

本次仅本地整理，GitHub 推送另行处理。临时拆分脚本、原页面快照及比较中间产物保留在 `codex-artifacts/tmp/maintainability-20261107/`：清理该目录的操作被自动审批策略拦截，未提供更具体原因。它们不参与启动与测试。
