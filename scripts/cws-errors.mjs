// Chrome Web Store API 호출 실패를 나타내는 오류. 오류 응답 본문(body)은 그대로 보존해서
// 호출한 쪽(scripts/cws-publish.mjs)이 가리거나 바꾸지 않고 그대로 노출할 수 있게 한다.
export class CwsApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'CwsApiError';
    this.status = status;
    this.body = body;
  }
}
