import { describe, expect, it } from "bun:test";
import { createSessionKeyService } from "../src/index.js";

const SECRET = "test-secret-that-is-long-enough";

describe("session keys", () => {
  it("issues a token that verifies back to its scope", () => {
    const svc = createSessionKeyService({ secret: SECRET });
    const { token, scope } = svc.issue({ agent: "0x2222222222222222222222222222222222222222", capWei: "10000" });
    expect(svc.verify(token)).toEqual(scope);
  });

  it("rejects a tampered payload", () => {
    const svc = createSessionKeyService({ secret: SECRET });
    const { token } = svc.issue({ agent: "0x2222222222222222222222222222222222222222", capWei: "10000" });
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ agent: "0x3333333333333333333333333333333333333333", capWei: "999999999999", expiresAt: 9999999999 })).toString("base64url");
    expect(svc.verify(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const a = createSessionKeyService({ secret: SECRET });
    const b = createSessionKeyService({ secret: "another-secret-long-enough" });
    const { token } = a.issue({ agent: "0x2222222222222222222222222222222222222222", capWei: "10000" });
    expect(b.verify(token)).toBeNull();
  });

  it("rejects expired tokens", () => {
    const svc = createSessionKeyService({ secret: SECRET });
    const { token } = svc.issue({ agent: "0x2222222222222222222222222222222222222222", capWei: "10000" }, 1);
    expect(svc.verify(token, Date.now() + 5000)).toBeNull();
  });

  it("rejects garbage", () => {
    const svc = createSessionKeyService({ secret: SECRET });
    expect(svc.verify("not-a-token")).toBeNull();
    expect(svc.verify("abc.")).toBeNull();
  });
});
