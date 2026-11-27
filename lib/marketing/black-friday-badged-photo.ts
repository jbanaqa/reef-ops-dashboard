import sharp from "sharp";
import badgeFont from "./black-friday-badge-glyphs.json";

const photoWidth = 360;
const photoHeight = 312;
const badgeWidth = 140;
const badgeHeight = 50;
const scale = 28 / badgeFont.unitsPerEm;

function badgeArtwork(discount: number) {
  // Outlines from the bundled SIL-OFL Barlow Black Italic font reproduce the
  // same lettering on every server, independent of installed system fonts.
  const glyphs = Array.from(`${discount}% OFF`, character =>
    badgeFont.glyphs[character as keyof typeof badgeFont.glyphs]);
  const textWidth = glyphs.reduce((width, glyph) => width + glyph.advance, 0) * scale;
  let offset = 0;
  const paths = glyphs.map(glyph => {
    const path = glyph.path ? `<path d="${glyph.path}" transform="translate(${offset} 0)"/>` : "";
    offset += glyph.advance;
    return path;
  }).join("");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth}" height="${badgeHeight}">
  <defs>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop stop-color="#ffe5a5"/>
      <stop offset="1" stop-color="#efb455"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="${badgeWidth - 2}" height="${badgeHeight - 2}" rx="6" fill="url(#gold)" stroke="#be8140" stroke-width="2"/>
  <g fill="#48213e" transform="translate(${(badgeWidth - textWidth) / 2} 34) scale(${scale} ${-scale})">${paths}</g>
</svg>`);
}

export function renderBlackFridayBadgedPhoto(source: Buffer, discount: number): Promise<Buffer> {
  return sharp(source, { limitInputPixels: 16_000_000 })
    .autoOrient()
    .resize(photoWidth, photoHeight, { fit: "cover", position: "centre" })
    .flatten({ background: "#4e214e" })
    .composite([{ input: badgeArtwork(discount), left: 32, top: 20 }])
    .jpeg({ quality: 88, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
