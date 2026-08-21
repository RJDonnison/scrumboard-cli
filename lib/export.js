const { launchChromium } = require("./browser");
const {
  sessionExists,
  getSessionPath,
  getBoardUrl,
  DEFAULT_BASE_URL,
} = require("./session-store");
const { isOnLoginPage } = require("./auth");
const { writeExport } = require("./file-export");
const fs = require("fs");
const path = require("path");

/**
 * Scrapes all task cards from the sprint board's columns. When
 * `includeDetails` is set, also opens each task's edit panel to pull its
 * description.
 *
 * @param {import("playwright").Page} page - Page currently on the board.
 * @param {boolean} includeDetails
 * @returns {Promise<Object[]>} One entry per task card, with its title,
 *   priority, complexity, time tracking, assignees, reviewers, status, and
 *   description (empty unless includeDetails).
 */
async function scrapeTasks(page, includeDetails) {
  const cards = await page.locator(".task-card").all();
  const tasks = await Promise.all(cards.map((card) => scrapeTaskCard(card)));

  if (!includeDetails) return tasks;

  for (let i = 0; i < cards.length; i++) {
    const { description } = await scrapeTaskDetails(page, cards[i], false);
    tasks[i].description = description;
  }

  return tasks;
}

/**
 * Reads the trimmed text content of the first match for a locator, or ""
 * if it has no matches.
 *
 * @param {import("playwright").Locator} locator
 * @returns {Promise<string>}
 */
async function textOrEmpty(locator, timeout = 5000) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    return "";
  }
  return ((await locator.first().textContent()) ?? "").trim();
}

/**
 * Scrapes the acceptance criteria listed within a story's detail modal.
 *
 * @param {import("playwright").Locator} modal
 * @param {string[]} [idLabel] Array of AC label's e.g. ["AC1", "AC2"]
 * @returns {Promise<Object[]>} One entry per AC, with its label and text.
 */
async function scrapeACs(modal, idLabels) {
  const items = await modal.locator('[id^="full-story-ac-"]').all();

  const acs = await Promise.all(
    items.map(async (item) => ({
      ac: await textOrEmpty(item.locator(".fw-bold")),
      text: await textOrEmpty(
        item.locator("span[style*='white-space: pre-wrap']"),
      ),
    })),
  );

  if (!idLabels) return acs;

  const normalized = idLabels.map((label) => label.trim().toLowerCase());
  return acs.filter((item) =>
    normalized.includes(item.ac.trim().toLowerCase()),
  );
}

/**
 * Scrapes all stories from the sprint board. When `includeDetails` is set,
 * opens each story's detail modal to also pull its description and
 * acceptance criteria.
 *
 * @param {import("playwright").Page} page - Page currently on the board.
 * @param {boolean} includeDetails
 * @returns {Promise<Object[]>} One entry per story, with its name,
 *   description, and acceptance criteria (empty unless includeDetails).
 */
async function scrapeStories(page, includeDetails) {
  const storyEls = await page.locator(".accordion.story").all();
  const stories = [];

  for (const story of storyEls) {
    const name = await textOrEmpty(story.locator('[id^="story-name-"]'));

    if (!includeDetails) {
      stories.push({ name });
      continue;
    }

    let description = "";
    let acs = [];

    const viewButton = story.locator('[id^="view-story-details-"]');

    if (await viewButton.count()) {
      await viewButton.click();

      const modal = page.locator("[id^='full-story-view-']");
      await modal.waitFor({ state: "visible" });

      description = await textOrEmpty(
        modal.locator("[id^='full-story-description-'] span p"),
      );
      acs = await scrapeACs(modal);

      await modal.locator(".btn-close").click();
      await modal.waitFor({ state: "hidden" });
    }

    stories.push({ name, description, acs });
  }

  return stories;
}

/**
 * Launches a browser, restores the saved session, and navigates to the
 * active project's board — throwing a clear error if that's not possible.
 * On error, the browser is closed before throwing so callers never leak it.
 *
 * @param {boolean} headed
 * @returns {Promise<{ browser: import("playwright").Browser, page: import("playwright").Page }>}
 */
async function openBoard(headed) {
  if (!sessionExists()) {
    throw new Error("Not logged in. Run `scrumboard-cli login` first.");
  }

  const browser = await launchChromium({ headless: !headed });

  try {
    const context = await browser.newContext({
      storageState: getSessionPath(),
    });
    const page = await context.newPage();

    await page.goto(getBoardUrl());
    await page.waitForLoadState("networkidle");

    if (await isOnLoginPage(page)) {
      throw new Error("Not logged in. Run `scrumboard-cli login` first.");
    }

    if (page.url().replace(/\/$/, "") === DEFAULT_BASE_URL) {
      throw new Error(
        "Redirected to the scrumboard home page — check that `scrumboard project <id>` is set to a valid project.",
      );
    }

    if (
      await page
        .getByText("This project does not have an active sprint")
        .count()
    ) {
      throw new Error("This project does not have an active sprint");
    }

    return { browser, page };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

/**
 * Logs into the active project's board using the saved session, scrapes
 * its tasks and stories, and writes the result to disk as JSON.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.details=false] - Whether to open each task's edit
 *   panel and each story's detail modal to also scrape descriptions (and,
 *   for stories, acceptance criteria).
 * @param {string} [opts.out] - Output directory or exact `.json` file path.
 * @param {boolean} [opts.headed=false] - Run the browser with a visible
 *   window instead of headless.
 * @returns {Promise<string>} Absolute path to the exported JSON file.
 */
async function exportBoard({ details = false, out, headed = false } = {}) {
  const { browser, page } = await openBoard(headed);

  try {
    const tasks = await scrapeTasks(page, details);
    const stories = await scrapeStories(page, details);

    return writeExport({ tasks, stories }, out);
  } finally {
    await browser.close();
  }
}

/**
 * Finds a single task card whose title contains a given substring (case-
 * insensitive) among all columns on the board.
 *
 * @param {import("playwright").Page} page
 * @param {string} query Substring to search for in the task title.
 * @returns {Promise<import("playwright").Locator>}
 */
async function findTaskCard(page, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");

  const card = page.locator(".task-card").filter({
    has: page.locator(".task-name strong", { hasText: regex }),
  });

  const count = await card.count();
  if (count === 0) {
    throw new Error(`No task found matching "${query}"`);
  }
  if (count > 1) {
    const titles = await card.locator(".task-name strong").allTextContents();
    throw new Error(
      `Found ${count} tasks matching "${query}": ${titles.map((t) => `"${t.trim()}"`).join(", ")} — narrow your search to match one.`,
    );
  }

  return card.first();
}

/**
 * Scrapes a single task card's board-level fields (title, priority,
 * complexity, time tracking, assignees, reviewers, status).
 *
 * @param {import("playwright").Locator} card
 * @returns {Promise<Object>}
 */
async function scrapeTaskCard(card) {
  return card.evaluate((cardEl) => {
    const status =
      cardEl
        .closest(".sprintboard-column")
        ?.querySelector(".column-name")
        ?.textContent.trim() ?? "Unknown";

    return {
      title:
        cardEl.querySelector(".task-name strong")?.textContent.trim() ?? "",
      priority:
        cardEl.querySelector("#card-priority")?.textContent.trim() ?? "",
      complexity:
        cardEl.querySelector("#card-complexity")?.textContent.trim() ?? "",
      time: {
        current:
          cardEl.querySelector("#time-remaining")?.textContent.trim() ?? "",
        estimated:
          cardEl.querySelector("#time-estimated")?.textContent.trim() ?? "",
      },
      assignees: Array.from(
        cardEl.querySelectorAll("#assignee-select .avatar-container"),
      ).map(
        (el) =>
          el.querySelector(".name-tooltip")?.textContent.trim() ??
          el.querySelector("img")?.alt ??
          "",
      ),
      reviewers: Array.from(
        cardEl.querySelectorAll("#reviewer-select .avatar-container"),
      ).map(
        (el) =>
          el.querySelector(".name-tooltip")?.textContent.trim() ??
          el.querySelector("img")?.alt ??
          "",
      ),
      status,
    };
  });
}

/**
 * Opens a task card's edit panel to scrape its description and, optionally,
 * the acceptance criteria listed within it, then closes the panel.
 *
 * @param {import("playwright").Page} page
 * @param {import("playwright").Locator} card
 * @param {boolean} includeAcs
 * @returns {Promise<{ description: string, acs: Object[] }>}
 */
async function scrapeTaskDetails(page, card, includeAcs) {
  const panel = page.locator("#task-edit-form");

  await card.click();
  await panel.waitFor({ state: "visible" });

  // The panel becomes visible before Blazor finishes binding its fields;
  // closing too early leaves it stuck open on a blank/invalid form.
  await page.waitForFunction(() => {
    const el = document.querySelector("#task-edit-form #name-input");
    return !!el?.value;
  });

  const description = await panel.locator("#description-input").inputValue();

  await panel.locator("#close-button").click();
  await panel.waitFor({ state: "hidden" });

  let acs = [];

  if (includeAcs) {
    const story = page.locator(".accordion.story").filter({ has: card });

    const viewButton = story.locator('[id^="view-story-details-"]');

    if (await viewButton.count()) {
      await viewButton.click();

      const modal = page.locator("[id^='full-story-view-']");
      await modal.waitFor({ state: "visible" });

      acs = await scrapeACs(modal, parseCoveredACs(description));

      await modal.locator(".btn-close").click();
      await modal.waitFor({ state: "hidden" });
    }
  }

  return { description, acs };
}

/**
 * Finds every AC label (e.g. "AC1", "AC12") mentioned anywhere in a task
 * description.
 *
 * @param {string} description
 * @returns {string[]} Referenced AC labels, e.g. ["AC1", "AC2"].
 */
function parseCoveredACs(description) {
  return description.match(/AC\d+/gi) ?? [];
}

/**
 * Logs into the active project's board using the saved session, finds a
 * single task by name, scrapes it, and writes the result to disk as JSON.
 *
 * @param {string} name - Task title to find (case-insensitive, exact
 *   match).
 * @param {Object} opts
 * @param {boolean} [opts.details=false] - Whether to open the task's edit
 *   panel to also scrape its description.
 * @param {boolean} [opts.includeAcs=false] - Whether to also scrape the
 *   acceptance criteria listed in the task's edit panel. Implies opening
 *   the panel even if `details` is false.
 * @param {string} [opts.out] - Output directory or exact `.json` file path.
 * @param {boolean} [opts.headed=false] - Run the browser with a visible
 *   window instead of headless.
 * @returns {Promise<string>} Absolute path to the exported JSON file.
 */
async function exportTask(
  name,
  { details = false, includeAcs = false, out, headed = false },
) {
  const { browser, page } = await openBoard(headed);

  try {
    const card = await findTaskCard(page, name);
    const task = await scrapeTaskCard(card);

    if (details || includeAcs) {
      const { description, acs } = await scrapeTaskDetails(
        page,
        card,
        includeAcs,
      );
      task.description = description;
      if (includeAcs) task.acs = acs;
    }

    const outPath = resolveTaskOutPath(out, task.title);
    return writeExport({ task }, outPath);
  } finally {
    await browser.close();
  }
}

/**
 * Makes a task name filesystem-safe
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
  return name.trim().replace(/[\\/:*?"<>|]+/g, "-");
}

/**
 * Resolves the final output path for a task export. If `out` is
 * already an exact `.json` path, it's returned as-is. Else the task's
 * name is used as the filename inside it.
 *
 * @param {string|undefined} out
 * @param {string} name
 * @returns {string}
 */
function resolveTaskOutPath(out, name) {
  out = out ?? "./";

  const isDir = out.toLowerCase().endsWith(".json")
    ? false
    : fs.existsSync(out)
      ? fs.statSync(out).isDirectory()
      : true;

  if (!isDir) return out;

  return path.join(out, `${sanitizeFilename(name)}.json`);
}

async function findStoryElement(page, id) {
  const story = page.locator(".accordion.story").filter({
    has: page.locator('[id^="story-name-"]', {
      hasText: new RegExp(id, "i"),
    }),
  });

  const count = await story.count();
  if (count === 0) {
    throw new Error(`No story found matching "${id}"`);
  }

  return story.first();
}

async function exportStory(id, { out, headed = false } = {}) {
  const { browser, page } = await openBoard(headed);

  try {
    const story = await findStoryElement(page, id);
    const name = await textOrEmpty(story.locator('[id^="story-name-"]'));

    let description = "";
    let acs = [];

    const viewButton = story.locator('[id^="view-story-details-"]');

    if (await viewButton.count()) {
      await viewButton.click();

      const modal = page.locator("[id^='full-story-view-']");
      await modal.waitFor({ state: "visible" });

      description = await textOrEmpty(
        modal.locator("[id^='full-story-description-'] span p"),
      );
      acs = await scrapeACs(modal);

      await modal.locator(".btn-close").click();
      await modal.waitFor({ state: "hidden" });
    }

    const storyData = { id, name, description, acs };

    const outPath = resolveTaskOutPath(out, name);
    return writeExport({ story: storyData }, outPath);
  } finally {
    await browser.close();
  }
}

module.exports = { exportBoard, exportTask, exportStory };
