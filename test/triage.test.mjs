import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { parseInput, triageText, validateModelOutput } from "../triage.mjs";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };
const quiet = { onFailure: () => {} };

describe("ответ модели", () => {
  for (const label of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    test(`${label} -> manual_review`, async () => {
      assert.deepEqual(await triageText(`Где мой заказ? ${label}`, quiet), MANUAL_REVIEW);
    });
  }

  test("таймаут срабатывает через ~300 мс, а не через 1,2 с имитатора", async () => {
    const started = performance.now();
    await triageText("[timeout]", quiet);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 290 && elapsed < 800, `ждали ${Math.round(elapsed)} мс`);
  });

  test("модель, которая не слушает AbortSignal, тоже ограничена таймаутом", async () => {
    const hanging = () => new Promise(() => {});
    assert.deepEqual(await triageText("текст", { ...quiet, classify: hanging, timeoutMs: 50 }), MANUAL_REVIEW);
  });

  test("корректный ответ -> ready с темой и черновиком", async () => {
    const result = await triageText("Когда будет доставка?", quiet);
    assert.equal(result.status, "ready");
    assert.equal(result.topic, "delivery");
    assert.ok(result.draft.trim().length > 0);
    assert.equal((await triageText("Какая цена?", quiet)).topic, "pricing");
    assert.equal((await triageText("Здравствуйте", quiet)).topic, "other");
  });

  test("validateModelOutput отсекает лишнее", () => {
    assert.equal(validateModelOutput("null"), null);
    assert.equal(validateModelOutput('{"topic":"other"}'), null);
    assert.equal(validateModelOutput('{"topic":"other","draft":42}'), null);
    assert.equal(validateModelOutput('{"topic":["other"],"draft":"ок"}'), null);
  });
});

describe("ввод", () => {
  test("невалидный ввод -> null", () => {
    for (const body of ["", "{", "null", "[]", "{}", '{"text":""}', '{"text":"   "}', '{"text":42}', '{"text":null}']) {
      assert.equal(parseInput(body), null, body);
    }
  });

  test("непустая строка проходит", () => {
    assert.equal(parseInput('{"text":"Где заказ?"}'), "Где заказ?");
  });
});

describe("HTTP API", () => {
  let server;
  let base;
  const post = (body) =>
    fetch(`${base}/api/triage`, { method: "POST", headers: { "Content-Type": "application/json" }, body });

  before(async () => {
    process.env.PORT = "0";
    ({ server } = await import("../server.mjs"));
    if (!server.listening) await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test("битый JSON и пустой текст -> 400 invalid_input", async () => {
    for (const body of ["{", '{"text":"  "}', '{"text":1}', "{}"]) {
      const reply = await post(body);
      assert.equal(reply.status, 400, body);
      assert.deepEqual(await reply.json(), { status: "invalid_input" });
    }
  });

  test("таймаут модели -> 200 manual_review быстрее секунды", async () => {
    const started = performance.now();
    const reply = await post(JSON.stringify({ text: "Где заказ? [timeout]" }));
    assert.ok(performance.now() - started < 1000);
    assert.equal(reply.status, 200);
    assert.deepEqual(await reply.json(), MANUAL_REVIEW);
  });

  test("ошибка модели и плохой ответ -> 200 manual_review", async () => {
    for (const label of ["[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
      const reply = await post(JSON.stringify({ text: `Заявка ${label}` }));
      assert.equal(reply.status, 200, label);
      assert.deepEqual(await reply.json(), MANUAL_REVIEW, label);
    }
  });

  test("обычная заявка -> 200 ready", async () => {
    const reply = await post(JSON.stringify({ text: "Сколько стоит доставка в Алматы?" }));
    assert.equal(reply.status, 200);
    const data = await reply.json();
    assert.equal(data.status, "ready");
    assert.ok(["delivery", "pricing", "other"].includes(data.topic));
    assert.ok(data.draft.trim());
  });
});
