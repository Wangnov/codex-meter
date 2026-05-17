(function () {
  "use strict";

  const bootstrapJson = () => {
    const raw = document.getElementById("client-bootstrap")?.textContent;
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const bootstrapLocale = () => {
    const raw = document.getElementById("client-bootstrap")?.textContent;
    if (!raw) return "";
    const parsed = bootstrapJson();
    if (parsed?.locale) return parsed.locale;
    return raw.match(/"locale"\s*:\s*"([^"]+)"/)?.[1] || "";
  };

  const getBootstrapToken = () => {
    const bootstrapData = document.getElementById("client-bootstrap")?.textContent || "";
    return bootstrapData.match(/[\w-]{30,}\.[\w-]{30,}\.[\w-]{30,}/)?.[0] || null;
  };

  const apiGet = async (path, token) => {
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: "include",
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message =
        body?.detail || body?.message || body?.error?.message || `${res.status} ${res.statusText}`;
      throw new Error(`${path}: ${message}`);
    }
    return body;
  };

  window.CodexMeterChatGptClient = {
    apiGet,
    bootstrapJson,
    bootstrapLocale,
    getBootstrapToken,
  };
})();
