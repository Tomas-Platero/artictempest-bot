const test = require("node:test");
const assert = require("node:assert/strict");
const { RecruitmentWebClient } = require("./web-client");

const BASE_URL = "https://web.example.com/";
const TOKEN = "test-token-123";

async function withFetchStub(impl, run) {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options);
  };

  try {
    return await run(calls);
  } finally {
    global.fetch = originalFetch;
  }
}

test("reportDelivery publica en el endpoint con bearer token", async () => {
  await withFetchStub(
    async () => ({
      ok: true,
      json: async () => ({ success: true, matched: true }),
    }),
    async (calls) => {
      const client = new RecruitmentWebClient(BASE_URL, TOKEN);
      const result = await client.reportDelivery("event-1", {
        ok: true,
        messageId: "msg-42",
      });

      assert.deepEqual(result, { success: true, matched: true });
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        "https://web.example.com/api/bot/recruitment/deliveries/report",
      );
      assert.equal(calls[0].options.method, "POST");
      assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
      assert.equal(
        calls[0].options.headers["Content-Type"],
        "application/json",
      );
    },
  );
});

test("reportDelivery serializa un envío correcto como sent", async () => {
  await withFetchStub(
    async () => ({ ok: true, json: async () => ({ success: true }) }),
    async (calls) => {
      const client = new RecruitmentWebClient(BASE_URL, TOKEN);
      await client.reportDelivery("event-2", {
        ok: true,
        messageId: "msg-99",
      });

      assert.deepEqual(JSON.parse(calls[0].options.body), {
        eventId: "event-2",
        status: "sent",
        discordMessageId: "msg-99",
        errorCode: null,
        errorMessage: null,
      });
    },
  );
});

test("reportDelivery serializa un fallo con el código como cadena", async () => {
  await withFetchStub(
    async () => ({ ok: true, json: async () => ({ success: true }) }),
    async (calls) => {
      const client = new RecruitmentWebClient(BASE_URL, TOKEN);
      await client.reportDelivery("event-3", {
        ok: false,
        code: 50007,
        message: "Cannot send messages to this user",
      });

      assert.deepEqual(JSON.parse(calls[0].options.body), {
        eventId: "event-3",
        status: "failed",
        discordMessageId: null,
        errorCode: "50007",
        errorMessage: "Cannot send messages to this user",
      });
    },
  );
});

test("reportDelivery ignora matched:false como respuesta normal", async () => {
  await withFetchStub(
    async () => ({
      ok: true,
      json: async () => ({ success: true, matched: false }),
    }),
    async () => {
      const client = new RecruitmentWebClient(BASE_URL, TOKEN);
      const result = await client.reportDelivery("event-4", { ok: true });

      assert.deepEqual(result, { success: true, matched: false });
    },
  );
});

test("reportDelivery lanza cuando el web responde no-ok", async () => {
  await withFetchStub(
    async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    }),
    async () => {
      const client = new RecruitmentWebClient(BASE_URL, TOKEN);

      await assert.rejects(
        () => client.reportDelivery("event-5", { ok: true }),
        /Delivery report failed \(500\): boom/,
      );
    },
  );
});

test("reportDelivery restaura global.fetch", async () => {
  const originalFetch = global.fetch;

  await withFetchStub(
    async () => ({ ok: true, json: async () => ({ success: true }) }),
    async () => {
      const client = new RecruitmentWebClient(BASE_URL, TOKEN);
      await client.reportDelivery("event-6", { ok: true });
      assert.notEqual(global.fetch, originalFetch);
    },
  );

  assert.equal(global.fetch, originalFetch);
});
