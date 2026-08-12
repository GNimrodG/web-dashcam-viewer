import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeClipFilename,
  parseByteRange,
  resolvePostLoginRedirect,
  sanitizeReturnPath,
} from "./http.js";

test("clip filenames cannot escape on either path platform", () => {
  assert.equal(isSafeClipFilename("clip.mp4"), true);
  assert.equal(isSafeClipFilename("../secret.mp4"), false);
  assert.equal(isSafeClipFilename("..\\secret.mp4"), false);
  assert.equal(isSafeClipFilename("clip.mov"), false);
});

test("byte ranges support bounded, open, and suffix forms", () => {
  assert.deepEqual(parseByteRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseByteRange("bytes=900-", 1000), {
    start: 900,
    end: 999,
  });
  assert.deepEqual(parseByteRange("bytes=-10", 1000), { start: 990, end: 999 });
  assert.deepEqual(parseByteRange("bytes=900-2000", 1000), {
    start: 900,
    end: 999,
  });
  assert.equal(parseByteRange("bytes=1000-", 1000), null);
  assert.equal(parseByteRange("bytes=20-10", 1000), null);
  assert.equal(parseByteRange("items=0-1", 1000), null);
});

test("return paths stay local", () => {
  assert.equal(sanitizeReturnPath("/clips?x=1#item"), "/clips?x=1#item");
  assert.equal(sanitizeReturnPath("https://evil.example/"), null);
  assert.equal(sanitizeReturnPath("//evil.example/"), null);
  assert.equal(sanitizeReturnPath(undefined), null);
});

test("post-login redirects prefer an explicitly configured frontend", () => {
  assert.equal(
    resolvePostLoginRedirect({
      returnPath: "/clips#item",
      frontendUrl: "https://viewer.example.com",
      oidcRedirectUri: "https://api.example.com/api/auth/callback",
      requestOrigin: "http://internal:3000",
    }),
    "https://viewer.example.com/clips#item",
  );
});

test("post-login redirects derive the production origin from the OIDC callback", () => {
  assert.equal(
    resolvePostLoginRedirect({
      returnPath: "/#recording-1",
      oidcRedirectUri: "https://dashcam.example.com/api/auth/callback",
      requestOrigin: "http://internal:3000",
    }),
    "https://dashcam.example.com/#recording-1",
  );
  assert.equal(
    resolvePostLoginRedirect({
      oidcRedirectUri: "https://dashcam.example.com/api/auth/callback",
      requestOrigin: "http://internal:3000",
    }),
    "https://dashcam.example.com/",
  );
});

test("post-login redirects ignore a stale localhost frontend for a public callback", () => {
  assert.equal(
    resolvePostLoginRedirect({
      frontendUrl: "http://localhost:5173",
      oidcRedirectUri: "https://dashcam.example.com/api/auth/callback",
      requestOrigin: "http://internal:3000",
    }),
    "https://dashcam.example.com/",
  );
});

test("post-login redirects fall back to the proxy-aware request origin", () => {
  assert.equal(
    resolvePostLoginRedirect({
      returnPath: "/recordings-map",
      requestOrigin: "https://dashcam.example.com",
    }),
    "https://dashcam.example.com/recordings-map",
  );
});
