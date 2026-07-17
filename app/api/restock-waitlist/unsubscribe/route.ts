import { unsubscribeProductRestockWaitlist } from "@/lib/product-restock-waitlist";

function htmlResponse(title: string, message: string, status = 200) {
  return new Response(
    `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${title}</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #f1f5f9;
              color: #0f172a;
              font-family: Arial, sans-serif;
            }

            main {
              width: min(520px, calc(100% - 32px));
              padding: 28px;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
              background: #ffffff;
              box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
            }

            h1 {
              margin: 0;
              font-size: 24px;
            }

            p {
              margin: 12px 0 0;
              color: #475569;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>
          <main>
            <h1>${title}</h1>
            <p>${message}</p>
          </main>
        </body>
      </html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const subscription = await unsubscribeProductRestockWaitlist(token);

  if (!subscription) {
    return htmlResponse(
      "Unsubscribe link not found",
      "This restock alert link is invalid or has already been removed.",
      404
    );
  }

  return htmlResponse(
    "You are unsubscribed",
    "You will no longer receive this product restock alert."
  );
}
