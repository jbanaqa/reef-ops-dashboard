import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  dailyDealsCountdownGif,
  nextPacificMidnight,
} from "../lib/marketing/daily-deals-countdown";
import { GET, HEAD } from "../app/api/marketing/daily-deals-countdown/route";

test("Daily Deals rollover follows Pacific local midnight in summer, winter and on DST transition days", () => {
  const cases = [
    ["2026-11-28T07:59:59Z", "2026-11-28T08:00:00Z"],
    ["2026-11-28T08:00:00Z", "2026-11-29T08:00:00Z"],
    ["2026-08-01T06:59:59Z", "2026-08-01T07:00:00Z"],
    ["2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z"], // 23 hours
    ["2026-11-01T07:00:00Z", "2026-11-02T08:00:00Z"], // 25 hours
  ];
  for (const [instant, deadline] of cases)
    assert.equal(nextPacificMidnight(Date.parse(instant)), Date.parse(deadline), instant);
});

test("Daily Deals GIF visibly ticks once per second, crosses midnight and stops on a neutral frame", async () => {
  const beforeMidnight = dailyDealsCountdownGif(new Date("2026-11-28T07:59:58Z"));
  const atMidnight = dailyDealsCountdownGif(new Date("2026-11-28T08:00:00Z"));
  const { width, pageHeight, pages, delay, loop } = await sharp(beforeMidnight, { animated: true }).metadata();
  assert.equal(width, 320);
  assert.equal(pageHeight, 64);
  assert.equal(pages, 61);
  assert.deepEqual(delay, Array(61).fill(1000));
  assert.equal(loop, 1);
  assert.ok(beforeMidnight.length < 128 * 1024);

  const decode = (data: Uint8Array<ArrayBuffer>) => sharp(data, { animated: true }).ensureAlpha().raw().toBuffer();
  const [beforePixels, midnightPixels] = await Promise.all([decode(beforeMidnight), decode(atMidnight)]);
  const frameBytes = width * pageHeight * 4;
  const frame = (image: Buffer, page: number) => image.subarray(page * frameBytes, (page + 1) * frameBytes);
  assert.notDeepEqual(frame(beforePixels, 0), frame(beforePixels, 1));
  assert.deepEqual(frame(beforePixels, 2), frame(midnightPixels, 0));
  assert.notDeepEqual(frame(beforePixels, 59), frame(beforePixels, 60));
  assert.deepEqual(frame(beforePixels, 60), frame(midnightPixels, 60));
});

test("The public Daily Deals URL serves an uncached GIF and supports metadata requests", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/gif");
  assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 6).toString(), "GIF89a");
  assert.equal(HEAD().body, null);
});
