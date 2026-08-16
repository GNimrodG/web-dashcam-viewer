import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { parseFilenameForPairing } from "./pairing.js";

test("keeps pairing Viofo underscored and plain date filenames", () => {
  assert.deepEqual(parseFilenameForPairing("2025_0910_131727_F.MP4"), {
    key: "20250910_131727",
    channel: "front",
    date: "20250910",
    time: "131727",
  });
  assert.deepEqual(parseFilenameForPairing("20250910_131727_R.MP4"), {
    key: "20250910_131727",
    channel: "rear",
    date: "20250910",
    time: "131727",
  });
  assert.deepEqual(parseFilenameForPairing("20250910_131727_front.mp4"), {
    key: "20250910_131727",
    channel: "front",
    date: "20250910",
    time: "131727",
  });
});

test("pairs BlackVue recording-type prefixed channel letters", () => {
  // BlackVue names files <type><direction>: N normal, E event, P parking, M manual.
  for (const type of ["N", "E", "P", "M"]) {
    assert.deepEqual(
      parseFilenameForPairing(`20250722_110221_${type}F.mp4`),
      {
        key: "20250722_110221",
        channel: "front",
        date: "20250722",
        time: "110221",
      },
      `front channel for recording type ${type}`,
    );
    assert.deepEqual(
      parseFilenameForPairing(`20250722_110221_${type}R.mp4`),
      {
        key: "20250722_110221",
        channel: "rear",
        date: "20250722",
        time: "110221",
      },
      `rear channel for recording type ${type}`,
    );
  }
});

test("pairs BlackVue front and rear clips onto one recording", () => {
  const front = parseFilenameForPairing(
    path.join("Z:\\dashcam", "BlackVue", "Record", "20250722_110221_NF.mp4"),
  );
  const rear = parseFilenameForPairing(
    path.join("Z:\\dashcam", "BlackVue", "Record", "20250722_110221_NR.mp4"),
  );
  assert.equal(front.key, rear.key);
  assert.equal(front.channel, "front");
  assert.equal(rear.channel, "rear");
});

test("ignores the BlackVue interior channel rather than mislabelling it", () => {
  // Three-channel models add an interior lens; this app only renders front/rear,
  // so leave the channel unset instead of showing cabin footage as the rear view.
  assert.equal(
    parseFilenameForPairing("20250722_110221_NI.mp4").channel,
    undefined,
  );
});
