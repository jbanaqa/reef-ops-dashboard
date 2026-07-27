This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Weighted collection rotation analytics

Collection Rotation works without external analytics by using product age,
rotation history, and order events already captured by Reef Ops. Optional data
sources improve the recent-performance score:

- **Shopify Reports:** the app installation needs the `read_reports` scope.
  Use **Refresh analytics** in Collection Rotation after the scope is granted.
- **Google Analytics 4:** add the service account as a Viewer on the GA4
  property, then configure:

```env
GA4_PROPERTY_ID=123456789
GA4_SERVICE_ACCOUNT_EMAIL=reef-ops@project.iam.gserviceaccount.com
GA4_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

To refresh configured sources automatically before scheduled rotations when
cached data is more than six hours old:

```env
COLLECTION_ROTATION_ANALYTICS_AUTO_SYNC=true
COLLECTION_ROTATION_ANALYTICS_LOOKBACK_DAYS=30
```

Analytics failures are recorded but do not block a scheduled rotation. GA4
must emit recommended ecommerce item events with a Shopify product identifier
in `item_id`. Supported forms are a numeric product ID,
`gid://shopify/Product/...`, and Shopify's
`shopify_US_<productId>_<variantId>` format.
