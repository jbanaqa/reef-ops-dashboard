declare module "gifenc" {
  export function GIFEncoder(options?: { initialCapacity?: number }): {
    writeFrame(
      pixels: Uint8Array,
      width: number,
      height: number,
      options: {
        palette?: number[][];
        colorDepth?: number;
        transparent?: boolean;
        delay?: number;
        repeat?: number;
        dispose?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
}
