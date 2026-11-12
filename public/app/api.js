'use strict';

(globalThis.NailMateApp ||= {}).createApi = function (getIdentityHeaders) {
  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('演示资料加载失败，请刷新重试。');
    return response.json();
  }

  async function requestState(action, payload = {}) {
    const response = await fetch('/api/team', {
      method: 'POST',
      headers: { ...getIdentityHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (response.status === 204) return null;
    if (response.status === 401) {
      location.reload();
      throw new Error('请重新登录。');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '操作未完成，请重试。');
    return result;
  }

  return { fetchJson, requestState };
};
