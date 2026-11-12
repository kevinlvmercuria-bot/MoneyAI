'use strict';

// 独立账号版不注册旧版接口，也不要求旧版会员表或 SQLite 来源。
require('../server/main').start({ legacy: false }).catch(error => {
    console.error('启动失败：', error.message);
    process.exitCode = 1;
});
