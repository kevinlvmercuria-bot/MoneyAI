async function api(path, body) {
    const options =
        body instanceof Blob
            ? {
                  method: 'POST',
                  headers: { 'Content-Type': body.type },
                  body,
              }
            : body === undefined
              ? {}
              : {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                };
    const response = await fetch('/api' + path, options);
    const payload = await response.json();
    if (!response.ok) {
        throw Object.assign(new Error(payload.error || '请求失败'), { status: response.status });
    }
    return payload;
}

export { api };
