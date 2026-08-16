import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { parseFilenameForPairing, type ParsedName } from "./pairing.js";

function assertParsed(fileName: string, expected: ParsedName) {
  assert.deepEqual(parseFilenameForPairing(fileName), expected, fileName);
}

const KEY = "20250910_131727";
const DATE = "20250910";
const TIME = "131727";

// Viofo labels the channels A/B on some models, F/R on others, 1/2 on others
// again. All three pairs mean the same two cameras.
const VIOFO_FRONT_TOKENS = ["A", "F", "1"];
const VIOFO_REAR_TOKENS = ["B", "R", "2"];

test("parses Viofo YYYY_MMDD_HHMMSS names for every channel token", () => {
  for (const token of VIOFO_FRONT_TOKENS) {
    assertParsed(`2025_0910_131727_${token}.MP4`, {
      key: KEY,
      channel: "front",
      date: DATE,
      time: TIME,
    });
  }
  for (const token of VIOFO_REAR_TOKENS) {
    assertParsed(`2025_0910_131727_${token}.MP4`, {
      key: KEY,
      channel: "rear",
      date: DATE,
      time: TIME,
    });
  }
});

test("parses Viofo YYYYMMDD_HHMMSS names for every channel token", () => {
  for (const token of VIOFO_FRONT_TOKENS) {
    assertParsed(`20250910_131727_${token}.MP4`, {
      key: KEY,
      channel: "front",
      date: DATE,
      time: TIME,
    });
  }
  for (const token of VIOFO_REAR_TOKENS) {
    assertParsed(`20250910_131727_${token}.MP4`, {
      key: KEY,
      channel: "rear",
      date: DATE,
      time: TIME,
    });
  }
});

test("accepts the Viofo hyphen separator, lower case and .mov", () => {
  const front = { key: KEY, channel: "front", date: DATE, time: TIME } as const;
  assertParsed("2025_0910_131727-F.MP4", front);
  assertParsed("20250910_131727-F.MP4", front);
  assertParsed("20250910_131727_f.mp4", front);
  assertParsed("20250910_131727_F.mov", front);
});

// BlackVue names clips <type><direction>: the type is why the clip was kept,
// the direction is which camera it came from.
const BLACKVUE_TYPES = ["N", "E", "P", "M"];

test("parses BlackVue names for every recording type", () => {
  for (const type of BLACKVUE_TYPES) {
    assertParsed(`20250910_131727_${type}F.mp4`, {
      key: KEY,
      channel: "front",
      date: DATE,
      time: TIME,
    });
    assertParsed(`20250910_131727_${type}R.mp4`, {
      key: KEY,
      channel: "rear",
      date: DATE,
      time: TIME,
    });
  }
});

test("accepts BlackVue lower case, .mov and a trailing marker", () => {
  const front = { key: KEY, channel: "front", date: DATE, time: TIME } as const;
  assertParsed("20250910_131727_nf.mp4", front);
  assertParsed("20250910_131727_NF.MOV", front);
  // Some models append a marker directly after the direction letter.
  assertParsed("20250910_131727_NF2.mp4", front);
});

test("ignores the BlackVue interior channel rather than mislabelling it", () => {
  // Three-channel models add an interior lens; this app only renders front and
  // rear, so leave the channel unset instead of showing cabin footage as the
  // rear view. The file then has no channel and drops out of the index.
  assertParsed("20250910_131727_NI.mp4", { key: "20250910_131727_ni" });
});

test("leaves an unknown recording type unparsed rather than guessing", () => {
  // Only N/E/P/M are documented BlackVue types. Anything else is some other
  // camera's naming scheme, and inventing a channel for it would pair the
  // wrong clips together.
  assertParsed("20250910_131727_XF.mp4", { key: "20250910_131727_xf" });
});

test("parses explicit front and rear words, with or without a middle segment", () => {
  assertParsed("20250910_131727_front.mp4", {
    key: KEY,
    channel: "front",
    date: DATE,
    time: TIME,
  });
  assertParsed("20250910_131727_rear.mp4", {
    key: KEY,
    channel: "rear",
    date: DATE,
    time: TIME,
  });
  assertParsed("20250910_131727_ch1_front.mp4", {
    key: KEY,
    channel: "front",
    date: DATE,
    time: TIME,
  });
});

test("falls back to front and rear appearing anywhere in the name", () => {
  // No timestamp to key on, so the channel word is stripped out and whatever
  // is left becomes the key: both cameras of one recording still meet.
  const front = parseFilenameForPairing("garage-front-cam.mp4");
  const rear = parseFilenameForPairing("garage-rear-cam.mp4");
  assert.equal(front.channel, "front");
  assert.equal(rear.channel, "rear");
  assert.equal(front.key, rear.key);
  assert.equal(front.date, undefined);
});

test("falls back to the bare filename when nothing matches", () => {
  assertParsed("holiday.mp4", { key: "holiday" });
});

test("keys off the filename, not the folders above it", () => {
  const viofo = parseFilenameForPairing(
    path.join("Z:\\dashcam", "RO", "2025_0910_131727_R.MP4"),
  );
  const blackvue = parseFilenameForPairing(
    path.join("Z:\\dashcam", "BlackVue", "Record", "20250910_131727_NR.mp4"),
  );
  assert.equal(viofo.key, KEY);
  assert.equal(blackvue.key, KEY);
});

test("both cameras of one recording share a pair key, for either brand", () => {
  const cases: [string, string][] = [
    ["2025_0910_131727_A.MP4", "2025_0910_131727_B.MP4"],
    ["20250910_131727_F.MP4", "20250910_131727_R.MP4"],
    ["20250910_131727_1.MP4", "20250910_131727_2.MP4"],
    ["20250910_131727_NF.mp4", "20250910_131727_NR.mp4"],
    ["20250910_131727_EF.mp4", "20250910_131727_ER.mp4"],
    ["20250910_131727_front.mp4", "20250910_131727_rear.mp4"],
  ];

  for (const [frontName, rearName] of cases) {
    const front = parseFilenameForPairing(frontName);
    const rear = parseFilenameForPairing(rearName);
    assert.equal(front.key, KEY, frontName);
    assert.equal(rear.key, KEY, rearName);
    assert.equal(front.channel, "front", frontName);
    assert.equal(rear.channel, "rear", rearName);
  }
});
