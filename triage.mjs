import { classify as mockClassify } from "./mock-ai.mjs";

export const TOPICS = new Set(["delivery", "pricing", "other"]);
export const MODEL_TIMEOUT_MS = 300;

const manualReview = () => ({ status: "manual_review", topic: null, draft: null });

function warn(reason, details) {
  console.warn(`[triage] manual_review: ${reason}`, details ?? "");
}

// Тело запроса -> текст заявки или null, если ввод невалидный.
export function parseInput(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const { text } = body;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text;
}

// Ответ модели -> { topic, draft } или null, если ответ нельзя показывать менеджеру.
// HTTP 200 от модели ещё не значит, что ответ годный: проверяем JSON, тему и черновик.
export function validateModelOutput(raw) {
  if (typeof raw !== "string") return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  const { topic, draft } = data;
  if (!TOPICS.has(topic)) return null;
  if (typeof draft !== "string" || draft.trim() === "") return null;
  return { topic, draft };
}

// Ждём модель не дольше timeoutMs. Любой сбой превращаем в manual_review.
export async function triageText(
  text,
  { classify = mockClassify, timeoutMs = MODEL_TIMEOUT_MS, onFailure = warn } = {},
) {
  const controller = new AbortController();
  const timeoutError = new Error(`model timeout ${timeoutMs} ms`);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  let raw;
  try {
    raw = await Promise.race([
      Promise.resolve().then(() => classify(text, { signal: controller.signal })),
      timeout,
    ]);
  } catch (error) {
    if (error === timeoutError) onFailure("timeout", error.message);
    else onFailure("model_error", error.message);
    return manualReview();
  } finally {
    clearTimeout(timer);
  }

  const result = validateModelOutput(raw);
  if (!result) {
    onFailure("invalid_output", String(raw).slice(0, 200));
    return manualReview();
  }
  return { status: "ready", ...result };
}
