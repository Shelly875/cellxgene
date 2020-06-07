import puppeteer from "puppeteer";
import { DEBUG, DEV } from "./config";
import puppeteerUtils from "./puppeteerUtils";
import cellxgeneActions from "./cellxgeneActions";

export default async function setupTestBrowser() {
  const browserViewport = { width: 1280, height: 960 };
  const browserParams = DEV
    ? {
        headless: false,
        slowMo: 5,
        args: [
          `--window-size=${browserViewport.width},${browserViewport.height}`,
        ],
      }
    : DEBUG
    ? {
        headless: false,
        slowMo: 100,
        devtools: true,
        args: [
          `--window-size=${browserViewport.width + 560},${
            browserViewport.height
          }`,
        ],
      }
    : {
        args: [
          `--window-size=${browserViewport.width},${browserViewport.height}`,
        ],
      };
  const browser = await puppeteer.launch(browserParams);
  const page = await browser.pages().then((pages) => pages[0]);
  await page.setViewport(browserViewport);
  if (DEV || DEBUG) {
    page.on("console", async (msg) => {
      // If there is a console.error but an error is not thrown, this will ensure the test fails
      console.log(`PAGE LOG: ${msg.text()}`);
      if (msg.type() === "error") {
        // TODO: chromium does not currently support the CSP directive on the
        // line below, so we swallow this error. Remove this when the test
        // suite uses a browser version that supports this directive.
        if (
          msg.text() ===
          "Unrecognized Content-Security-Policy directive 'require-trusted-types-for'.\n"
        )
          return;
        const errorMsgText = await Promise.all(
          // TODO can we do this without internal properties?
          msg.args().map((arg) => arg._remoteObject.description)
        );
        throw new Error(`Console error: ${errorMsgText}`);
      }
    });
  }
  page.on("pageerror", (err) => {
    console.log(`PAGE LOG: ${msg.text()}`);
    throw new Error(`Console error: ${err}`);
  });
  page.on("error", (err) => {
    console.log(`PAGE LOG: ${msg.text()}`);
    throw new Error(`Console error: ${err}`);
  });
  const utils = puppeteerUtils(page);
  const cxgActions = cellxgeneActions(page, utils);
  return [browser, page, utils, cxgActions];
}
