import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  profile?: {
    name?: string;
    url?: string;
  };
};

type BraveSearchResponse = {
  web?: {
    results?: BraveWebResult[];
  };
};

const defaultQueries = [
  `"Corals Anonymous"`,
  `"Corals Anonymous" review`,
  `"Corals Anonymous" reef2reef`,
  `"Corals Anonymous" reddit`,
  `"Corals Anonymous" DOA`,
  `"Macroalgae Farms"`,
  `"Macroalgae Farms" review`,
  `site:reef2reef.com "Corals Anonymous"`,
  `site:reddit.com "Corals Anonymous"`,
];

const defaultExcludedDomains = [
  "coralsanonymous.com",
  "macroalgaefarms.com",
  "corals-anonymous.myshopify.com",
  "macroalgaefarms.myshopify.com",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "tiktok.com",
];

function getHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeDomain(domain: string) {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

function shouldExcludeUrl(url: string, excludedDomains: string[]) {
  const hostname = getHostname(url);

  if (!hostname) {
    return true;
  }

  const normalizedHostname = normalizeDomain(hostname);
  const normalizedExcludedDomains = excludedDomains.map(normalizeDomain);

  return normalizedExcludedDomains.some((excludedDomain) => {
    return (
      normalizedHostname === excludedDomain ||
      normalizedHostname.endsWith(`.${excludedDomain}`)
    );
  });
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.BRAVE_SEARCH_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing BRAVE_SEARCH_API_KEY in .env.local." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));

    const queries: string[] =
      Array.isArray(body.queries) && body.queries.length > 0
        ? body.queries
        : defaultQueries;

    const excludedDomains: string[] =
      Array.isArray(body.excludedDomains) && body.excludedDomains.length > 0
        ? body.excludedDomains
        : defaultExcludedDomains;

    const allResults = [];

    for (const query of queries) {
      const params = new URLSearchParams({
        q: query,
        count: "5",
        country: "US",
        search_lang: "en",
      });

      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();

        return NextResponse.json(
          {
            error: `Brave Search failed for query: ${query}`,
            details: errorText,
          },
          { status: response.status }
        );
      }

      const data = (await response.json()) as BraveSearchResponse;
      const results = data.web?.results || [];

      for (const result of results) {
        const url = result.url || "";

        allResults.push({
          query,
          title: result.title || "Untitled result",
          url,
          description: result.description || "",
          age: result.age || "",
          sourceName: result.profile?.name || "",
          sourceUrl: result.profile?.url || "",
          domain: getHostname(url),
        });
      }
    }

    const dedupedResults = Array.from(
      new Map(allResults.map((result) => [result.url, result])).values()
    ).filter((result) => result.url);

    const filteredResults = dedupedResults.filter(
      (result) => !shouldExcludeUrl(result.url, excludedDomains)
    );

    let newStoredCount = 0;
    let alreadySeenCount = 0;

    for (const result of filteredResults) {
      const existing = await prisma.scanResult.findUnique({
        where: {
          url: result.url,
        },
      });

      if (existing) {
        alreadySeenCount += 1;

        await prisma.scanResult.update({
          where: {
            id: existing.id,
          },
          data: {
            lastSeenAt: new Date(),
          },
        });

        continue;
      }

      await prisma.scanResult.create({
        data: {
          source: "Brave Search",
          query: result.query,
          title: result.title,
          url: result.url,
          domain: result.domain || null,
          description: result.description || null,
          age: result.age || null,
          sourceName: result.sourceName || null,
          sourceUrl: result.sourceUrl || null,
          status: "New",
        },
      });

      newStoredCount += 1;
    }

    const pendingResults = await prisma.scanResult.findMany({
      where: {
        status: "New",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      scannedQueries: queries,
      totalResultCount: dedupedResults.length,
      filteredOutCount: dedupedResults.length - filteredResults.length,
      candidateResultCount: filteredResults.length,
      alreadySeenCount,
      newStoredCount,
      resultCount: pendingResults.length,
      excludedDomains,
      results: pendingResults,
    });
  } catch (error) {
    console.error("Brave monitoring scan error:", error);

    return NextResponse.json(
      { error: "Failed to run Brave monitoring scan." },
      { status: 500 }
    );
  }
}