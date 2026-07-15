import { prisma } from "@/lib/prisma";
import {
  getShopifyShopDomain,
  shopifyGraphql,
} from "@/lib/shopify";

const PRODUCT_PAGE_SIZE = 250;
const COLLECTION_PAGE_SIZE = 100;
const MAX_MOVES_PER_JOB = 250;
const JOB_POLL_INTERVAL_MS = 1_500;
const JOB_TIMEOUT_MS = 120_000;

type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

export type CollectionProduct = {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
};

export type ShopifyCollectionSummary = {
  id: string;
  legacyResourceId: string;
  title: string;
  handle: string;
  sortOrder: string;
  productsCount: number;
};

export type ShopifyCollection =
  ShopifyCollectionSummary & {
    products: CollectionProduct[];
  };

type ProductMove = {
  id: string;
  newPosition: string;
};

type ControlledProductRule = {
  shopifyProductId: string;
  position: number;
};

type CollectionControlRules = {
  controlledTopCount: number;
  controlledProducts: ControlledProductRule[];
};

type CollectionsPageResponse = {
  data?: {
    collections?: {
      nodes: Array<{
        id: string;
        legacyResourceId: string;
        title: string;
        handle: string;
        sortOrder: string;
        productsCount: {
          count: number;
        };
      }>;
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
};

type CollectionPageResponse = {
  data?: {
    collection?: {
      id: string;
      legacyResourceId: string;
      title: string;
      handle: string;
      sortOrder: string;
      productsCount: {
        count: number;
      };
      products: {
        nodes: CollectionProduct[];
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    } | null;
  };
};

type CollectionUpdateResponse = {
  data?: {
    collectionUpdate?: {
      collection?: {
        id: string;
        sortOrder: string;
      } | null;
      job?: {
        id: string;
        done: boolean;
      } | null;
      userErrors: ShopifyUserError[];
    } | null;
  };
};

type CollectionReorderResponse = {
  data?: {
    collectionReorderProducts?: {
      job?: {
        id: string;
      } | null;
      userErrors: ShopifyUserError[];
    } | null;
  };
};

type JobResponse = {
  data?: {
    job?: {
      id: string;
      done: boolean;
    } | null;
  };
};

const COLLECTIONS_QUERY = `
  query CollectionsForRotation($after: String) {
    collections(first: ${COLLECTION_PAGE_SIZE}, after: $after) {
      nodes {
        id
        legacyResourceId
        title
        handle
        sortOrder
        productsCount {
          count
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTION_PRODUCTS_QUERY = `
  query CollectionProducts($id: ID!, $after: String) {
    collection(id: $id) {
      id
      legacyResourceId
      title
      handle
      sortOrder
      productsCount {
        count
      }
      products(first: ${PRODUCT_PAGE_SIZE}, after: $after) {
        nodes {
          id
          legacyResourceId
          title
          handle
          featuredImage {
            url
            altText
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

const UPDATE_COLLECTION_SORT_ORDER_MUTATION = `
  mutation UpdateCollectionSortOrder(
    $input: CollectionUpdateInput!
  ) {
    collectionUpdate(collection: $input) {
      collection {
        id
        sortOrder
      }
      job {
        id
        done
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const REORDER_COLLECTION_PRODUCTS_MUTATION = `
  mutation ReorderCollectionProducts(
    $id: ID!
    $moves: [MoveInput!]!
  ) {
    collectionReorderProducts(id: $id, moves: $moves) {
      job {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const JOB_QUERY = `
  query ShopifyJob($id: ID!) {
    job(id: $id) {
      id
      done
    }
  }
`;

function toCollectionGid(collectionId: string) {
  if (
    collectionId.startsWith(
      "gid://shopify/Collection/"
    )
  ) {
    return collectionId;
  }

  return `gid://shopify/Collection/${collectionId}`;
}

function formatUserErrors(
  errors: ShopifyUserError[]
) {
  return errors
    .map((error) => {
      const field = error.field?.length
        ? `${error.field.join(".")}: `
        : "";

      return `${field}${error.message}`;
    })
    .join("; ");
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function arraysEqual(
  first: readonly string[],
  second: readonly string[]
) {
  if (first.length !== second.length) {
    return false;
  }

  return first.every(
    (value, index) =>
      value === second[index]
  );
}

function parseStoredProductIds(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error(
      "The saved product-order snapshot is invalid."
    );
  }

  const productIds = value.filter(
    (item): item is string =>
      typeof item === "string"
  );

  if (productIds.length !== value.length) {
    throw new Error(
      "The saved product-order snapshot contains invalid IDs."
    );
  }

  return productIds;
}

function validateTargetOrder(
  currentProductIds: readonly string[],
  targetProductIds: readonly string[]
) {
  if (
    currentProductIds.length !==
    targetProductIds.length
  ) {
    throw new Error(
      "The target order no longer matches the number of products in the collection."
    );
  }

  const currentIdSet =
    new Set(currentProductIds);

  const targetIdSet =
    new Set(targetProductIds);

  if (
    currentIdSet.size !==
    currentProductIds.length
  ) {
    throw new Error(
      "The current collection order contains duplicate product IDs."
    );
  }

  if (
    targetIdSet.size !==
    targetProductIds.length
  ) {
    throw new Error(
      "The target order contains duplicate product IDs."
    );
  }

  for (const productId of currentProductIds) {
    if (!targetIdSet.has(productId)) {
      throw new Error(
        "The target order does not contain the same products as the collection."
      );
    }
  }
}

export function shuffleArray<T>(
  items: readonly T[]
) {
  const result = [...items];

  for (
    let index = result.length - 1;
    index > 0;
    index -= 1
  ) {
    const randomIndex = Math.floor(
      Math.random() * (index + 1)
    );

    [result[index], result[randomIndex]] = [
      result[randomIndex],
      result[index],
    ];
  }

  return result;
}

function createControlledShuffle(
  productIds: readonly string[],
  rules: CollectionControlRules
) {
  const effectiveTopCount = Math.min(
    Math.max(
      Math.floor(rules.controlledTopCount),
      0
    ),
    productIds.length
  );

  const validProductIdSet =
    new Set(productIds);

  const assignedProductIds =
    new Set<string>();

  const validRules = rules.controlledProducts
    .filter((rule) => {
      if (
        rule.position < 1 ||
        rule.position > effectiveTopCount
      ) {
        return false;
      }

      if (
        !validProductIdSet.has(
          rule.shopifyProductId
        )
      ) {
        return false;
      }

      if (
        assignedProductIds.has(
          rule.shopifyProductId
        )
      ) {
        return false;
      }

      assignedProductIds.add(
        rule.shopifyProductId
      );

      return true;
    })
    .sort(
      (first, second) =>
        first.position - second.position
    );

  const randomPool = shuffleArray(
    productIds.filter(
      (productId) =>
        !assignedProductIds.has(productId)
    )
  );

  const targetOrder =
    new Array<string | null>(
      productIds.length
    ).fill(null);

  for (const rule of validRules) {
    targetOrder[rule.position - 1] =
      rule.shopifyProductId;
  }

  let poolIndex = 0;

  for (
    let index = 0;
    index < targetOrder.length;
    index += 1
  ) {
    if (targetOrder[index] !== null) {
      continue;
    }

    targetOrder[index] =
      randomPool[poolIndex] ?? null;

    poolIndex += 1;
  }

  const completedOrder = targetOrder.filter(
    (productId): productId is string =>
      typeof productId === "string"
  );

  validateTargetOrder(
    productIds,
    completedOrder
  );

  return completedOrder;
}

export function createProductMoves(
  currentProductIds: readonly string[],
  targetProductIds: readonly string[]
): ProductMove[] {
  validateTargetOrder(
    currentProductIds,
    targetProductIds
  );

  const workingOrder = [
    ...currentProductIds,
  ];

  const moves: ProductMove[] = [];

  for (
    let targetIndex = 0;
    targetIndex <
    targetProductIds.length;
    targetIndex += 1
  ) {
    const desiredProductId =
      targetProductIds[targetIndex];

    if (
      workingOrder[targetIndex] ===
      desiredProductId
    ) {
      continue;
    }

    const currentIndex =
      workingOrder.indexOf(
        desiredProductId,
        targetIndex + 1
      );

    if (currentIndex === -1) {
      throw new Error(
        `Could not locate product ${desiredProductId} while preparing the Shopify moves.`
      );
    }

    moves.push({
      id: desiredProductId,
      newPosition: String(targetIndex),
    });

    workingOrder.splice(
      currentIndex,
      1
    );

    workingOrder.splice(
      targetIndex,
      0,
      desiredProductId
    );
  }

  return moves;
}

function chunkMoves(moves: ProductMove[]) {
  const chunks: ProductMove[][] = [];

  for (
    let index = 0;
    index < moves.length;
    index += MAX_MOVES_PER_JOB
  ) {
    chunks.push(
      moves.slice(
        index,
        index + MAX_MOVES_PER_JOB
      )
    );
  }

  return chunks;
}

async function waitForShopifyJob(
  jobId: string
) {
  const startedAt = Date.now();

  while (
    Date.now() - startedAt <
    JOB_TIMEOUT_MS
  ) {
    const response =
      await shopifyGraphql<JobResponse>(
        JOB_QUERY,
        {
          id: jobId,
        }
      );

    const job = response.data?.job;

    if (!job) {
      throw new Error(
        `Shopify job could not be found: ${jobId}`
      );
    }

    if (job.done) {
      return;
    }

    await sleep(
      JOB_POLL_INTERVAL_MS
    );
  }

  throw new Error(
    `Shopify did not finish the reorder within ${
      JOB_TIMEOUT_MS / 1000
    } seconds.`
  );
}

export async function listShopifyCollections() {
  const collections:
    ShopifyCollectionSummary[] = [];

  let after: string | null = null;

  do {
    const response: CollectionsPageResponse =
      await shopifyGraphql<CollectionsPageResponse>(
        COLLECTIONS_QUERY,
        {
          after,
        }
      );

    const connection =
      response.data?.collections;

    if (!connection) {
      throw new Error(
        "Shopify did not return a collection list."
      );
    }

    collections.push(
      ...connection.nodes.map(
        (collection) => ({
          id: collection.id,
          legacyResourceId: String(
            collection.legacyResourceId
          ),
          title: collection.title,
          handle: collection.handle,
          sortOrder:
            collection.sortOrder,
          productsCount:
            collection.productsCount.count,
        })
      )
    );

    after =
      connection.pageInfo.hasNextPage
        ? connection.pageInfo.endCursor
        : null;
  } while (after);

  return collections.sort(
    (first, second) =>
      second.productsCount -
        first.productsCount ||
      first.title.localeCompare(
        second.title
      )
  );
}

export async function getCollectionWithProducts(
  collectionId: string
): Promise<ShopifyCollection> {
  const gid =
    toCollectionGid(collectionId);

  let after: string | null = null;

  let baseCollection:
    | Omit<
        ShopifyCollection,
        "products"
      >
    | null = null;

  const products: CollectionProduct[] =
    [];

  do {
    const response: CollectionPageResponse =
      await shopifyGraphql<CollectionPageResponse>(
        COLLECTION_PRODUCTS_QUERY,
        {
          id: gid,
          after,
        }
      );

    const collection =
      response.data?.collection;

    if (!collection) {
      throw new Error(
        `Shopify collection was not found: ${collectionId}`
      );
    }

    if (!baseCollection) {
      baseCollection = {
        id: collection.id,
        legacyResourceId: String(
          collection.legacyResourceId
        ),
        title: collection.title,
        handle: collection.handle,
        sortOrder:
          collection.sortOrder,
        productsCount:
          collection.productsCount.count,
      };
    }

    products.push(
      ...collection.products.nodes
    );

    after =
      collection.products.pageInfo
        .hasNextPage
        ? collection.products.pageInfo
            .endCursor
        : null;
  } while (after);

  if (!baseCollection) {
    throw new Error(
      "Shopify returned no collection information."
    );
  }

  return {
    ...baseCollection,
    products,
  };
}

async function getControlRules(
  shop: string,
  collectionId: string
): Promise<CollectionControlRules> {
  const rotation =
    await prisma.collectionRotation.findUnique({
      where: {
        shop_shopifyCollectionId: {
          shop,
          shopifyCollectionId:
            collectionId,
        },
      },
      select: {
        controlledTopCount: true,
        controlledProducts: {
          select: {
            shopifyProductId: true,
            position: true,
          },
          orderBy: {
            position: "asc",
          },
        },
      },
    });

  return {
    controlledTopCount:
      rotation?.controlledTopCount ?? 0,
    controlledProducts:
      rotation?.controlledProducts ?? [],
  };
}

async function ensureManualSortOrder(
  collection: ShopifyCollection
) {
  if (
    collection.sortOrder === "MANUAL"
  ) {
    return;
  }

  const response =
    await shopifyGraphql<CollectionUpdateResponse>(
      UPDATE_COLLECTION_SORT_ORDER_MUTATION,
      {
        input: {
          id: collection.id,
          sortOrder: "MANUAL",
        },
      }
    );

  const payload =
    response.data?.collectionUpdate;

  if (!payload) {
    throw new Error(
      "Shopify did not return a collection update result."
    );
  }

  if (
    payload.userErrors.length > 0
  ) {
    throw new Error(
      `Shopify could not change the collection sorting to Manual: ${formatUserErrors(
        payload.userErrors
      )}`
    );
  }

  if (
    payload.job &&
    !payload.job.done
  ) {
    await waitForShopifyJob(
      payload.job.id
    );
  }

  const updatedCollection =
    await getCollectionWithProducts(
      collection.id
    );

  if (
    updatedCollection.sortOrder !==
    "MANUAL"
  ) {
    throw new Error(
      "Shopify did not change the collection sorting to Manual."
    );
  }
}

async function submitMoveChunk(
  collectionId: string,
  moves: ProductMove[]
) {
  if (moves.length === 0) {
    return null;
  }

  const response =
    await shopifyGraphql<CollectionReorderResponse>(
      REORDER_COLLECTION_PRODUCTS_MUTATION,
      {
        id: collectionId,
        moves,
      }
    );

  const payload =
    response.data
      ?.collectionReorderProducts;

  if (!payload) {
    throw new Error(
      "Shopify did not return a collection reorder result."
    );
  }

  if (
    payload.userErrors.length > 0
  ) {
    throw new Error(
      `Shopify rejected the collection reorder: ${formatUserErrors(
        payload.userErrors
      )}`
    );
  }

  if (!payload.job?.id) {
    throw new Error(
      "Shopify accepted the reorder but did not return a job ID."
    );
  }

  await waitForShopifyJob(
    payload.job.id
  );

  return payload.job.id;
}

async function applyTargetOrder(
  collectionId: string,
  currentProductIds: string[],
  targetProductIds: string[]
) {
  const moves = createProductMoves(
    currentProductIds,
    targetProductIds
  );

  const moveChunks =
    chunkMoves(moves);

  const jobIds: string[] = [];

  for (const moveChunk of moveChunks) {
    const jobId =
      await submitMoveChunk(
        collectionId,
        moveChunk
      );

    if (jobId) {
      jobIds.push(jobId);
    }
  }

  return {
    movesCount: moves.length,
    jobIds,
  };
}

export async function shuffleCollection(
  collectionId: string,
  triggerType = "Manual"
) {
  const shop =
    getShopifyShopDomain();

  const originalCollection =
    await getCollectionWithProducts(
      collectionId
    );

  if (
    originalCollection.products.length <
    2
  ) {
    throw new Error(
      "This collection needs at least two products before it can be shuffled."
    );
  }

  const existingRun =
    await prisma.collectionRotationRun.findFirst({
      where: {
        shop,
        shopifyCollectionId:
          originalCollection.id,
        status: "Running",
      },
      select: {
        id: true,
      },
    });

  if (existingRun) {
    throw new Error(
      "This collection already has an operation in progress."
    );
  }

  const rotation =
    await prisma.collectionRotation.upsert({
      where: {
        shop_shopifyCollectionId: {
          shop,
          shopifyCollectionId:
            originalCollection.id,
        },
      },
      update: {
        collectionTitle:
          originalCollection.title,
        collectionHandle:
          originalCollection.handle,
      },
      create: {
        shop,
        shopifyCollectionId:
          originalCollection.id,
        collectionTitle:
          originalCollection.title,
        collectionHandle:
          originalCollection.handle,
      },
    });

  const controlRules =
    await getControlRules(
      shop,
      originalCollection.id
    );

  const originalProductIds =
    originalCollection.products.map(
      (product) => product.id
    );

  let targetProductIds =
    createControlledShuffle(
      originalProductIds,
      controlRules
    );

  for (
    let attempt = 0;
    attempt < 5 &&
    arraysEqual(
      originalProductIds,
      targetProductIds
    );
    attempt += 1
  ) {
    targetProductIds =
      createControlledShuffle(
        originalProductIds,
        controlRules
      );
  }

  const run =
    await prisma.collectionRotationRun.create({
      data: {
        rotationId: rotation.id,
        shop,
        shopifyCollectionId:
          originalCollection.id,
        collectionTitle:
          originalCollection.title,
        triggerType,
        status: "Running",
        productCount:
          originalProductIds.length,
        previousProductIds:
          originalProductIds,
        shuffledProductIds:
          targetProductIds,
      },
    });

  try {
    await ensureManualSortOrder(
      originalCollection
    );

    const latestCollection =
      await getCollectionWithProducts(
        originalCollection.id
      );

    const latestProductIds =
      latestCollection.products.map(
        (product) => product.id
      );

    if (
      !arraysEqual(
        originalProductIds,
        latestProductIds
      )
    ) {
      targetProductIds =
        createControlledShuffle(
          latestProductIds,
          controlRules
        );

      await prisma.collectionRotationRun.update({
        where: {
          id: run.id,
        },
        data: {
          productCount:
            latestProductIds.length,
          previousProductIds:
            latestProductIds,
          shuffledProductIds:
            targetProductIds,
        },
      });
    }

    const reorderResult =
      await applyTargetOrder(
        latestCollection.id,
        latestProductIds,
        targetProductIds
      );

    const verifiedCollection =
      await getCollectionWithProducts(
        latestCollection.id
      );

    const verifiedProductIds =
      verifiedCollection.products.map(
        (product) => product.id
      );

    if (
      !arraysEqual(
        verifiedProductIds,
        targetProductIds
      )
    ) {
      throw new Error(
        "Shopify finished the reorder, but the final collection order did not match the generated order."
      );
    }

    const completedAt =
      new Date();

    await prisma.$transaction([
      prisma.collectionRotationRun.update({
        where: {
          id: run.id,
        },
        data: {
          status: "Completed",
          shopifyJobIds:
            reorderResult.jobIds,
          completedAt,
        },
      }),

      prisma.collectionRotation.update({
        where: {
          id: rotation.id,
        },
        data: {
          lastShuffledAt:
            completedAt,
          lastStatus: "Completed",
          lastError: null,
        },
      }),
    ]);

    return {
      runId: run.id,
      collection: {
        id: verifiedCollection.id,
        title:
          verifiedCollection.title,
        handle:
          verifiedCollection.handle,
        productCount:
          verifiedCollection.products
            .length,
      },
      controlledTopCount:
        Math.min(
          controlRules.controlledTopCount,
          verifiedProductIds.length
        ),
      controlledAssignedCount:
        controlRules.controlledProducts.filter(
          (rule) =>
            verifiedProductIds.includes(
              rule.shopifyProductId
            )
        ).length,
      movesCount:
        reorderResult.movesCount,
      jobIds: reorderResult.jobIds,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown collection shuffle error.";

    await prisma.$transaction([
      prisma.collectionRotationRun.update({
        where: {
          id: run.id,
        },
        data: {
          status: "Failed",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),

      prisma.collectionRotation.update({
        where: {
          id: rotation.id,
        },
        data: {
          lastStatus: "Failed",
          lastError: message,
        },
      }),
    ]);

    throw error;
  }
}

export async function undoLastCollectionShuffle(
  collectionId: string
) {
  const shop =
    getShopifyShopDomain();

  const collection =
    await getCollectionWithProducts(
      collectionId
    );

  const rotation =
    await prisma.collectionRotation.findUnique({
      where: {
        shop_shopifyCollectionId: {
          shop,
          shopifyCollectionId:
            collection.id,
        },
      },
    });

  if (!rotation) {
    throw new Error(
      "This collection does not have a saved shuffle to undo."
    );
  }

  const existingRun =
    await prisma.collectionRotationRun.findFirst({
      where: {
        shop,
        shopifyCollectionId:
          collection.id,
        status: "Running",
      },
      select: {
        id: true,
      },
    });

  if (existingRun) {
    throw new Error(
      "This collection already has an operation in progress."
    );
  }

  const originalRun =
    await prisma.collectionRotationRun.findFirst({
      where: {
        rotationId: rotation.id,
        status: "Completed",
        undoneAt: null,
        triggerType: {
          in: [
            "Manual",
            "Batch",
            "Scheduled",
          ],
        },
      },
      orderBy: {
        completedAt: "desc",
      },
    });

  if (!originalRun) {
    throw new Error(
      "This collection does not have a completed shuffle available to undo."
    );
  }

  const savedPreviousIds =
    parseStoredProductIds(
      originalRun.previousProductIds
    );

  const currentProductIds =
    collection.products.map(
      (product) => product.id
    );

  const currentIdSet =
    new Set(currentProductIds);

  const savedIdSet =
    new Set(savedPreviousIds);

  const restoredExistingIds =
    savedPreviousIds.filter(
      (productId) =>
        currentIdSet.has(productId)
    );

  const newlyAddedIds =
    currentProductIds.filter(
      (productId) =>
        !savedIdSet.has(productId)
    );

  const targetProductIds = [
    ...restoredExistingIds,
    ...newlyAddedIds,
  ];

  validateTargetOrder(
    currentProductIds,
    targetProductIds
  );

  const undoRun =
    await prisma.collectionRotationRun.create({
      data: {
        rotationId: rotation.id,
        shop,
        shopifyCollectionId:
          collection.id,
        collectionTitle:
          collection.title,
        triggerType: "Undo",
        status: "Running",
        productCount:
          currentProductIds.length,
        previousProductIds:
          currentProductIds,
        shuffledProductIds:
          targetProductIds,
      },
    });

  try {
    await ensureManualSortOrder(
      collection
    );

    const latestCollection =
      await getCollectionWithProducts(
        collection.id
      );

    const latestProductIds =
      latestCollection.products.map(
        (product) => product.id
      );

    const latestIdSet =
      new Set(latestProductIds);

    const latestSavedIdSet =
      new Set(savedPreviousIds);

    const latestRestoredIds =
      savedPreviousIds.filter(
        (productId) =>
          latestIdSet.has(productId)
      );

    const latestNewIds =
      latestProductIds.filter(
        (productId) =>
          !latestSavedIdSet.has(
            productId
          )
      );

    const latestTargetIds = [
      ...latestRestoredIds,
      ...latestNewIds,
    ];

    validateTargetOrder(
      latestProductIds,
      latestTargetIds
    );

    await prisma.collectionRotationRun.update({
      where: {
        id: undoRun.id,
      },
      data: {
        productCount:
          latestProductIds.length,
        previousProductIds:
          latestProductIds,
        shuffledProductIds:
          latestTargetIds,
      },
    });

    const reorderResult =
      await applyTargetOrder(
        latestCollection.id,
        latestProductIds,
        latestTargetIds
      );

    const verifiedCollection =
      await getCollectionWithProducts(
        latestCollection.id
      );

    const verifiedProductIds =
      verifiedCollection.products.map(
        (product) => product.id
      );

    if (
      !arraysEqual(
        verifiedProductIds,
        latestTargetIds
      )
    ) {
      throw new Error(
        "Shopify finished the undo operation, but the restored order did not match the saved order."
      );
    }

    const completedAt =
      new Date();

    await prisma.$transaction([
      prisma.collectionRotationRun.update({
        where: {
          id: undoRun.id,
        },
        data: {
          status: "Completed",
          shopifyJobIds:
            reorderResult.jobIds,
          completedAt,
        },
      }),

      prisma.collectionRotationRun.update({
        where: {
          id: originalRun.id,
        },
        data: {
          status: "Undone",
          undoneAt: completedAt,
        },
      }),

      prisma.collectionRotation.update({
        where: {
          id: rotation.id,
        },
        data: {
          lastStatus:
            "Undo Completed",
          lastError: null,
        },
      }),
    ]);

    return {
      runId: undoRun.id,
      undoneRunId:
        originalRun.id,
      collection: {
        id: verifiedCollection.id,
        title:
          verifiedCollection.title,
        handle:
          verifiedCollection.handle,
        productCount:
          verifiedCollection.products
            .length,
      },
      movesCount:
        reorderResult.movesCount,
      jobIds:
        reorderResult.jobIds,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown collection undo error.";

    await prisma.$transaction([
      prisma.collectionRotationRun.update({
        where: {
          id: undoRun.id,
        },
        data: {
          status: "Failed",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),

      prisma.collectionRotation.update({
        where: {
          id: rotation.id,
        },
        data: {
          lastStatus:
            "Undo Failed",
          lastError: message,
        },
      }),
    ]);

    throw error;
  }
}