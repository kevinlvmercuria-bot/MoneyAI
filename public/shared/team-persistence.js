'use strict';

// 只负责演示状态的序列化；存储由调用方传入，业务引擎不直接访问 localStorage。
(function () {
  function createPreviewPersistence(snapshotId, storage) {
    const key = 'nailmate-wechat-preview-v1-' + snapshotId;
    return {
      simulation: true,
      load: () => JSON.parse(storage.getItem(key) || 'null'),
      save: state => storage.setItem(key, JSON.stringify(state)),
    };
  }

  if (typeof module !== 'undefined') module.exports = { createPreviewPersistence };
  else globalThis.NailMatePersistence = { createPreviewPersistence };
})();
