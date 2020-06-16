import { setDefaultOptions } from "expect-puppeteer";
import { isDebug, isDev } from "./config";

// (thuang): This is the max time a test can take to run.
// Since when debugging, we run slowMo and !headless, this means
// a test can take more time to finish, so we don't want
// jest to shut off the test too soon
jest.setTimeout(2 * 60 * 1000);
setDefaultOptions({ timeout: 20 * 1000 });

// (thuang): Please make sure this number matches
// `RETRY_ATTEMPTS` in `screenshot_env.js`
jest.retryTimes(2);

beforeEach(async () => {
  await jestPuppeteer.resetBrowser();

  const userAgent = await browser.userAgent();
  await page.setUserAgent(`${userAgent}bot`);

  await page._client.send("Animation.setPlaybackRate", { playbackRate: 12 });

  page.on("pageerror", (err) => {
    console.log(`PAGE LOG: ${msg.text()}`);
    throw new Error(`Console error: ${err}`);
  });

  page.on("error", (err) => {
    console.log(`PAGE LOG: ${msg.text()}`);
    throw new Error(`Console error: ${err}`);
  });

  if (isDev || isDebug) {
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
        ) {
          return;
        }
        const errorMsgText = await Promise.all(
          // TODO can we do this without internal properties?
          msg.args().map((arg) => arg._remoteObject.description)
        );
        throw new Error(`Console error: ${errorMsgText}`);
      }
    });
  }
});
