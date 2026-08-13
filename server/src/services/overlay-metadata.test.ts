import assert from "node:assert/strict";
import test from "node:test";
import { parseOverlayTsv } from "./overlay-metadata.js";

test("extracts camera type and plate from the spatial middle overlay block", () => {
  const header =
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
  const rows = [
    "1\t1\t0\t0\t0\t0\t0\t0\t7680\t180\t-1\t",
    "5\t1\t1\t1\t1\t1\t56\t28\t424\t78\t80\t025KM/H",
    "5\t1\t1\t1\t1\t2\t558\t28\t452\t82\t80\tN:47.4845",
    "5\t1\t1\t1\t1\t3\t1058\t28\t420\t82\t60\tE19.0536",
    "5\t1\t1\t1\t1\t4\t3408\t28\t292\t78\t88\tVIOFO",
    "5\t1\t1\t1\t1\t5\t3744\t28\t218\t78\t90\tA139",
    "5\t1\t1\t1\t1\t6\t4010\t28\t206\t78\t90\tPRO",
    "5\t1\t1\t1\t1\t7\t4282\t28\t376\t78\t48\tTEST123",
    "5\t1\t1\t1\t1\t8\t6252\t30\t202\t74\t87\tHDR",
    "5\t1\t1\t1\t1\t9\t6682\t28\t532\t78\t91\t2026/05/09",
  ];
  const result = parseOverlayTsv([header, ...rows].join("\n"));
  assert.equal(result?.cameraType, "VIOFO A139 PRO");
  assert.equal(result?.licensePlate, "TEST123");
  assert.deepEqual(result?.plateBounds, {
    left: 4282,
    width: 376,
    pageWidth: 7680,
  });
});

test("rejects a line without a middle camera and plate block", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t1920\t180\t-1\t",
    "5\t1\t1\t1\t1\t1\t10\t20\t200\t50\t90\t000KM/H",
    "5\t1\t1\t1\t1\t2\t1600\t20\t200\t50\t90\tHDR",
  ].join("\n");
  assert.equal(parseOverlayTsv(tsv), undefined);
});
