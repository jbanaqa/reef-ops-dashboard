export const SALE_ROTATION_DISCOUNTS = [5, 10, 15, 20] as const;
export type SaleRotationDiscount = (typeof SALE_ROTATION_DISCOUNTS)[number];

export type SaleRotationPlanProduct = {
  id: string;
  shopifyProductId: string;
  active: boolean;
  twentyPercentCandidate: boolean;
  fixedInSale: boolean;
};

export type SaleRotationPlanSettings = {
  discountCount5: number;
  discountCount10: number;
  discountCount15: number;
  discountCount20: number;
};

export function shuffleValues<T>(values: T[], random: () => number = Math.random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function selectHistoryAwareProducts<T extends { id: string }>(
  products: T[],
  count: number,
  lastSale: Map<string, number>,
  random: () => number = Math.random,
) {
  return products
    .map((product) => ({ product, lastSale: lastSale.get(product.id) ?? -1, tieBreaker: random() }))
    .sort((left, right) => left.lastSale - right.lastSale || left.tieBreaker - right.tieBreaker)
    .slice(0, count)
    .map((entry) => entry.product);
}

export function buildSaleSelection<T extends SaleRotationPlanProduct>(
  products: T[],
  settings: SaleRotationPlanSettings,
  lastSale: Map<string, number>,
  random: () => number = Math.random,
) {
  const active = products.filter((product) => product.active);
  const selected = new Map<string, SaleRotationDiscount>();
  const fixedTwenty = active.filter((product) => product.twentyPercentCandidate && product.fixedInSale);
  if (fixedTwenty.length > settings.discountCount20) {
    throw new Error(`There are ${fixedTwenty.length} fixed 20% products, but settings provide only ${settings.discountCount20} 20% slots.`);
  }

  const rotatingTwentyCount = settings.discountCount20 - fixedTwenty.length;
  const rotatingTwentyPool = active.filter((product) => product.twentyPercentCandidate && !product.fixedInSale);
  if (rotatingTwentyPool.length < rotatingTwentyCount) {
    throw new Error(`The sale requires ${rotatingTwentyCount} rotating 20% products, but only ${rotatingTwentyPool.length} are available.`);
  }
  const rotatingTwenty = selectHistoryAwareProducts(rotatingTwentyPool, rotatingTwentyCount, lastSale, random);

  const standardPool = active.filter((product) => !product.twentyPercentCandidate);
  const standardCount = settings.discountCount5 + settings.discountCount10 + settings.discountCount15;
  if (standardPool.length < standardCount) {
    throw new Error(`The sale requires ${standardCount} standard products, but only ${standardPool.length} are available.`);
  }
  const randomizedStandard = shuffleValues(
    selectHistoryAwareProducts(standardPool, standardCount, lastSale, random),
    random,
  );

  let offset = 0;
  for (const [discount, count] of [
    [5, settings.discountCount5],
    [10, settings.discountCount10],
    [15, settings.discountCount15],
  ] as const) {
    randomizedStandard.slice(offset, offset + count).forEach((product) => selected.set(product.id, discount));
    offset += count;
  }
  fixedTwenty.forEach((product) => selected.set(product.id, 20));
  rotatingTwenty.forEach((product) => selected.set(product.id, 20));

  return {
    selected,
    fixedTwenty,
    rotatingTwenty,
    randomizedStandard,
    nextSale: [...randomizedStandard, ...fixedTwenty, ...rotatingTwenty],
    twentyPercentProducts: [...fixedTwenty, ...rotatingTwenty],
  };
}
