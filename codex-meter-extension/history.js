(async function () {
  'use strict';
  const archive = window.CodexMeterQuotaArchive;
  const status = document.getElementById('status');
  let all = [];
  const number = value => Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 3 }) : '未知';
  const render = () => {
    const selected = document.getElementById('account').value;
    const rows = all.filter(row => selected === 'all' || row.accountScope === selected);
    const previous = new Map();
    const changes = new Map();
    [...all].reverse().forEach(row => {
      const prior = previous.get(row.accountScope);
      changes.set(row.key, prior > 0 && row.basis > 0 ? (row.basis / prior - 1) * 100 : null);
      if (row.basis > 0) previous.set(row.accountScope, row.basis);
    });
    const body = document.getElementById('rows');
    body.replaceChildren();
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const delta = changes.get(row.key);
      const values = [new Date(row.capturedAt).toLocaleString('zh-CN'), row.accountScope,
        number(row.basis), row.count ? `${number(row.min)} – ${number(row.max)}` : '未知',
        delta == null ? '—' : `${delta >= 0 ? '+' : ''}${number(delta)}%`, row.count,
        row.count ? `${row.startDate} – ${row.endDate}` : '无有效样本'];
      values.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row';
        cell.textContent = value;
        tr.append(cell);
      });
      body.append(tr);
    });
    status.textContent = `共 ${all.length} 份长期快照，当前显示 ${rows.length} 份。`;
  };
  document.getElementById('account').addEventListener('change', render);
  document.getElementById('export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), snapshots: all }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `codex-meter-quota-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  try {
    const cached = await chrome.storage.local.get(['codexQuotaCompassLatest', 'codexQuotaCompassSnapshots']);
    await archive.saveReports([...(cached.codexQuotaCompassSnapshots || []), cached.codexQuotaCompassLatest].filter(Boolean));
    all = await archive.list();
    for (const scope of new Set(all.map(row => row.accountScope))) {
      const option = document.createElement('option'); option.value = scope; option.textContent = scope;
      document.getElementById('account').append(option);
    }
    render();
  } catch { status.textContent = '本地归档读取或迁移失败。请保留原快照并导出备份。'; }
})();
