// Копия mock-ai.mjs из репозитория для браузера.
// Единственное отличие: delay из node:timers/promises заменён на setTimeout с поддержкой AbortSignal.
function delay(ms, value, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("The operation was aborted", "AbortError"));
    if (signal?.aborted) return abort();
    const timer = setTimeout(() => resolve(value), ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); abort(); }, { once: true });
  });
}

export async function classify(text, { signal } = {}) {
  const lower = text.toLowerCase();
  if (lower.includes("[timeout]")) await delay(1_200, undefined, { signal });
  if (lower.includes("[error]")) throw new Error("Mock provider unavailable");
  if (lower.includes("[bad-json]")) return "model output is not JSON";

  let topic = "other";
  if (lower.includes("достав")) topic = "delivery";
  if (lower.includes("цен") || lower.includes("стоим")) topic = "pricing";
  if (lower.includes("[bad-topic]")) topic = "refund";

  return JSON.stringify({
    topic,
    draft: lower.includes("[empty-draft]") ? "  " : "Спасибо за обращение. Уточним детали заявки.",
  });
}
