# 云端账号演示模拟资料

`team-demo.json.gz` 是云端演示构建实际依赖的运行资源，需随源码提交。

- 来源：固定提交 `09ca7b6dfa78278c4a4b401f1a0ec31d5fad7695` 中 `nailmate/NailMate_AI_微信分享版.html` 的 `nailmate-data` JSON。
- 内容：2,800 位模拟会员及其模拟订单、产品、预约、联系日志、备注、护理档案和活动任务；不从本机 `data/` 或业务数据库提取。
- 压缩前 JSON（UTF-8，JSON.stringify）的 SHA-256：`10296198bdfb91f9cbf5adb21a88c99e56e23de6270123e28d5c26609d4a5a02`。
- 构建入口：`node scripts/prepare-cloud-demo.js`。解压并验证后写入被忽略的 `data/team-data.json`；不需要 `.git`、Git remote、Git 客户端或联网。
- 若目标已有不同内容，构建停止，不覆盖原文件。模拟资料不包含数据库账号、真实企微凭据或登录密码。
