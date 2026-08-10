// 입력 검증 분기 단위 테스트 (AWS 호출 없이 동작)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "./index.ts";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("OPTIONS preflight returns CORS headers", async () => {
  const resp = await handle(new Request("http://localhost/", { method: "OPTIONS" }));
  assertEquals(resp.status, 200);
  assertEquals(resp.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("missing selfie returns API_ERROR 400", async () => {
  const resp = await handle(makeReq({ id_photo_base64: "abc" }));
  assertEquals(resp.status, 400);
  const json = await resp.json();
  assertEquals(json.match, false);
  assertEquals(json.errorCode, "API_ERROR");
  assertEquals(json.name_on_id, null);
});

Deno.test("missing id_photo returns API_ERROR 400", async () => {
  const resp = await handle(makeReq({ selfie_base64: "abc" }));
  assertEquals(resp.status, 400);
  const json = await resp.json();
  assertEquals(json.errorCode, "API_ERROR");
});

Deno.test("malformed JSON body returns API_ERROR 400", async () => {
  const resp = await handle(new Request("http://localhost/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "not-json{",
  }));
  assertEquals(resp.status, 400);
  const json = await resp.json();
  assertEquals(json.errorCode, "API_ERROR");
});

Deno.test("response always includes name_on_id=null and confidence", async () => {
  const resp = await handle(makeReq({}));
  const json = await resp.json();
  assertEquals(json.name_on_id, null);
  assertEquals(json.confidence, "low");
  assertEquals(typeof json.reason, "string");
});
