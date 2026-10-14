export function normalizeAutomationRate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseFloat(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

export function getAutomationRate(row) {
  return normalizeAutomationRate(row?.rate);
}

export function formatAutomationRate(value) {
  const rate = normalizeAutomationRate(value);
  return rate === null ? '미입력' : `${rate.toLocaleString('ko-KR', { maximumFractionDigits: 20 })}%`;
}

export function averageAutomationRate(rows = []) {
  const rates = rows.map(getAutomationRate).filter((rate) => rate !== null);
  return rates.length ? Math.round((rates.reduce((sum, rate) => sum + rate, 0) / rates.length) * 10) / 10 : null;
}

export function summarizeAutomationRate(rows = []) {
  const rates = rows.map(getAutomationRate);
  const inputCount = rates.filter((rate) => rate !== null).length;
  return {
    taskCount: rows.length,
    inputCount,
    missingCount: rows.length - inputCount,
    averageRate: averageAutomationRate(rows)
  };
}
