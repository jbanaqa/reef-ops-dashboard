import { inflateRawSync } from "node:zlib";
import { GIFEncoder } from "gifenc";
import {
  DAILY_DEALS_COUNTDOWN_HEIGHT as height,
  DAILY_DEALS_COUNTDOWN_WIDTH as width,
  DAILY_DEALS_TIMEZONE,
} from "./daily-deals-countdown-config";
import glyphs from "./daily-deals-countdown-glyphs.json";

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: DAILY_DEALS_TIMEZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** Encode Pacific wall-clock parts as a UTC date so calendar arithmetic is DST-independent. */
function pacificWallClock(instant: number) {
  const parts = clock.formatToParts(instant);
  const get = (name: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(({ type }) => type === name)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Return the actual UTC instant for the next Pacific calendar midnight. */
export function nextPacificMidnight(instant: number) {
  const tomorrow = new Date(pacificWallClock(instant));
  const wallMidnight = tomorrow.setUTCHours(24, 0, 0, 0);
  const candidate = wallMidnight + (wallMidnight - pacificWallClock(wallMidnight));
  // Resolve the offset at midnight itself if the calendar boundary spans a shift.
  return candidate + wallMidnight - pacificWallClock(candidate);
}

const secondsPerFrame = 1;
const animationSeconds = 60;
const maxClockSeconds = 99 * 3600 + 59 * 60 + 59;
const digitWidth = 31;
const digitHeight = 47;
const digitStarts = [14, 45, 129, 160, 244, 275];
const ink = [
  [255, 230, 80], // digits
  [206, 139, 184], // colons
  [255, 235, 248], // labels and final frame
];
const shadeCount = 4;

function makePalette(background: number[], transparent: boolean) {
  // Blend the edges into the panel color even when index zero is transparent.
  return [transparent ? [0, 0, 0] : background, ...ink.flatMap(color =>
    Array.from({ length: shadeCount }, (_, level) => color.map((value, channel) => {
      const opacity = (level + 1) / shadeCount;
      return Math.round(background[channel] * (1 - opacity) + value * opacity);
    })),
  )];
}

const transparentPalette = makePalette([75, 18, 78], true);
const plumPalette = makePalette([51, 23, 63], false);

/** Barlow weight 800 numerals/colons and weight 700 labels, rasterized from the design preview. */
function imageMask(compressed: string, inkIndex: number) {
  return Uint8Array.from(inflateRawSync(Buffer.from(compressed, "base64")), alpha => {
    const shade = Math.round(alpha * shadeCount / 255);
    return shade ? inkIndex * shadeCount + shade : 0;
  });
}

const labelPixels = imageMask(glyphs.labels, 2);
const colonPixels = imageMask(glyphs.colons, 1);
const face = labelPixels.map((label, i) => label || colonPixels[i]);
const neutral = imageMask(glyphs.neutral, 2);
const digits = glyphs.digits.map(glyph => {
  const pixels = imageMask(glyph, 0);
  return Array.from({ length: digitHeight }, (_, y) =>
    pixels.subarray(y * digitWidth, (y + 1) * digitWidth));
});

function clockFace(seconds: number) {
  const values = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  const figures = values.map(value => String(value).padStart(2, "0")).join("");
  const pixels = face.slice();
  digitStarts.forEach((x, index) => {
    digits[Number(figures[index])].forEach((row, y) => pixels.set(row, y * width + x));
  });
  return pixels;
}

type CountdownOptions = { deadline?: number; background?: "plum" };
let lastImage: CountdownOptions & { start: number; data: Uint8Array<ArrayBuffer> } | undefined;

/** Animate once, then leave a neutral link prompt instead of looping outdated figures. */
export function dailyDealsCountdownGif(now = new Date(), { deadline, background }: CountdownOptions = {}) {
  const instant = now.getTime();
  const start = deadline === undefined
    ? Math.floor(instant / 1000) * 1000
    : deadline - Math.ceil((deadline - instant) / 1000) * 1000;
  if (lastImage?.start === start && lastImage.deadline === deadline && lastImage.background === background) {
    return lastImage.data;
  }

  let target = deadline ?? nextPacificMidnight(start);
  const transparent = background !== "plum";
  const palette = transparent ? transparentPalette : plumPalette;
  const gif = GIFEncoder({ initialCapacity: 64 * 1024 });
  const animatedFrame = {
    colorDepth: 4,
    transparent,
    dispose: 2,
    delay: secondsPerFrame * 1000,
    repeat: -1,
  };
  let hasClockFrame = false;
  for (let offset = 0; offset < animationSeconds; offset += secondsPerFrame) {
    const at = start + offset * 1000;
    if (deadline === undefined && at >= target) target = nextPacificMidnight(at);
    const seconds = (target - at) / 1000;
    if (seconds < 1 || seconds > maxClockSeconds) break;
    gif.writeFrame(
      clockFace(seconds),
      width,
      height,
      offset === 0 ? { ...animatedFrame, palette } : animatedFrame,
    );
    hasClockFrame = true;
  }
  gif.writeFrame(neutral, width, height, {
    ...animatedFrame,
    dispose: 1,
    palette: hasClockFrame ? undefined : palette,
  });
  gif.finish();
  const data = gif.bytes();
  lastImage = { start, deadline, background, data };
  return data;
}
