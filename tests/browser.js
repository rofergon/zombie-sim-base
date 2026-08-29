"use strict";

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");

async function launch() {
  const options = { headless: true };
  if (process.env.ZS_BROWSER_PATH) options.executablePath = process.env.ZS_BROWSER_PATH;
  return chromium.launch(options);
}

function pageUrl(name, query) {
  const url = pathToFileURL(path.join(ROOT, name));
  url.search = new URLSearchParams(query || {}).toString();
  return url.href;
}

async function openSim(browser, name, query) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(pageUrl(name, query));
  await page.waitForFunction(() => window.ZS && ZS.debug && ZS.scenario);
  return { context, page, errors };
}

function assertNoErrors(errors, label) {
  if (errors.length) throw new Error(label + " browser errors:\n" + errors.join("\n"));
}

module.exports = { assertNoErrors, launch, openSim, pageUrl };
