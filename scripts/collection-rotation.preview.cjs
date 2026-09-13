// Local-only populated UI preview, used for browser verification.
const { build } = require("esbuild");
const fs = require("node:fs");
const http = require("node:http");
(async () => {
  const bundle = await build({
    entryPoints: ["scripts/collection-rotation.browser.fixture.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  http
    .createServer((req, res) => {
      if (req.url === "/app.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(bundle.outputFiles[0].contents);
      } else if (req.url === "/style.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(
          fs.readFileSync("app/globals.css", "utf8") +
            fs.readFileSync(
              "app/collection-rotation/rotation-workspace.css",
              "utf8",
            ),
        );
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
        );
      }
    })
    .listen(3019, "127.0.0.1", () =>
      console.log("Isolated collection UI preview: http://127.0.0.1:3019"),
    );
})();
