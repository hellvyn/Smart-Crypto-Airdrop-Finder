import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { adminClient, createConfirmedUser, deleteCreatedUsers, uniqueEmail } from "./support/admin";
import { cleanupSeed, seedCoachProjects, type CoachSeedProject } from "./support/seed";

// The model is a local stub (e2e/support/llm-stub.mjs, LLM_BASE_URL in playwright.config.ts): nothing here calls a real
// model. The stub plans over the first three candidates and answers a chat turn by naming the first candidate.

const PASSWORD = "correct-horse-1";
const NOL = "Langkah 0: bikin wallet dulu, lalu simpan seed phrase-nya di kertas, jangan di HP";
const HINT = "Banyak airdrop bisa digarap tanpa modal. Pilih 'Gratis aja' kalau belum mau keluar uang sama sekali.";
let projects: CoachSeedProject[];

test.beforeAll(async () => {
  projects = await seedCoachProjects(3);
});

test.afterAll(async () => {
  await deleteCreatedUsers();
  await cleanupSeed();
});

async function signIn(page: Page, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await createConfirmedUser(email, PASSWORD);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/watchlist$/);
  return email;
}

async function userIdOf(email: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error("test user not found");
  return user.id;
}

/** Chooses the option labelled `name` in the dropdown that has it. */
const pick = (page: Page, name: string) =>
  page.locator("select", { has: page.getByRole("option", { name, exact: true }) }).selectOption({ label: name });

/** Fills the form as an experienced member with two wallets and a whole hour a day. */
async function fillProPlan(page: Page): Promise<void> {
  await page.goto("/coach");
  await pick(page, "Pro");
  await pick(page, "> $1.000");
  await pick(page, "Udah");
  await page.getByLabel("Jumlah wallet").selectOption("2");
  await pick(page, "60 menit");
  await pick(page, "Jangka panjang");
  await page.getByRole("button", { name: "Simpan dan bikin rencana" }).click();
}

const cards = (page: Page) => page.locator(".coach-card");

test("a visitor sees AI Coach in the menu and a KHUSUS MEMBER stamp on /coach, with no form and no chat", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "AI Coach" }).click();
  await expect(page).toHaveURL(/\/coach$/);
  await expect(page.getByRole("img", { name: "KHUSUS MEMBER" })).toBeVisible();
  await expect(page.getByLabel("Level kamu")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kirim" })).toHaveCount(0);
});

test("a member fills the form, gets a plan, starts farming from a card and finds it on /garapan", async ({ page }) => {
  await signIn(page, "coach-plan");
  await expect(page.getByRole("banner").getByRole("link", { name: "AI Coach" })).toHaveAttribute("href", "/coach");
  await fillProPlan(page);

  await expect(page.getByRole("heading", { name: "Rencana garapan kamu" })).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
  // A Pro with a wallet gets neither the reminder nor Langkah 0.
  await expect(page.getByTestId("coach-security")).toHaveCount(0);
  await expect(page.getByTestId("coach-langkah-nol")).toHaveCount(0);

  const first = cards(page).first();
  const name = (await first.locator(".coach-card-name").textContent()) ?? "";
  expect(projects.map((p) => p.name)).toContain(name);
  await expect(first.getByTestId("risk-badge")).toBeVisible();
  await expect(first.getByText("Gratis", { exact: true })).toBeVisible();
  await expect(first.getByText("Estimasi 10 menit per hari")).toBeVisible();
  await expect(first.locator("blockquote")).toContainText("Bridge sedikit ETH ke Base");
  // Free capital: the note about gas on mainnet.
  await expect(first).toContainText("mungkin tetap butuh sedikit gas kalau di mainnet");
  // Nothing in a card leaves the site.
  const hrefs = await cards(page).locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href).toMatch(/^\/projects\//);

  await first.getByRole("button", { name: "Mulai garap" }).click();
  await expect(first.getByText("Udah masuk Garapan saya.")).toBeVisible();
  await first.getByRole("link", { name: "Buka Garapan saya" }).click();
  await expect(page).toHaveURL(/\/garapan$/);
  await expect(page.getByRole("article", { name })).toBeVisible();
});

test("a Pemula without a wallet gets the hint, the security reminder and Langkah 0 above the plan", async ({ page }) => {
  await signIn(page, "coach-pemula");
  await page.goto("/coach");
  await expect(page.getByText(HINT)).toHaveCount(0);
  await pick(page, "Pemula");
  await expect(page.getByText(HINT)).toBeVisible();
  await pick(page, "Gratis aja ($0)");
  await pick(page, "Belum");
  await expect(page.getByLabel("Jumlah wallet")).toHaveCount(0);
  await pick(page, "30 menit");
  await pick(page, "Belajar dulu");
  await page.getByRole("button", { name: "Simpan dan bikin rencana" }).click();

  await expect(cards(page).first()).toBeVisible();
  const security = page.getByTestId("coach-security");
  await expect(security).toContainText("Seed phrase dan private key gak pernah dibagi ke siapa pun");
  await expect(page.getByTestId("coach-langkah-nol")).toHaveText(NOL);
  // Both come before the first card.
  const order = await page.evaluate(() => {
    const pos = (sel: string) => [...document.querySelectorAll("*")].findIndex((e) => e.matches(sel));
    return [pos("[data-testid=coach-security]"), pos("[data-testid=coach-langkah-nol]"), pos(".coach-card")];
  });
  expect(order[0]).toBeLessThan(order[2]!);
  expect(order[1]).toBeLessThan(order[2]!);
});

test("the form says what is missing and does not save", async ({ page }) => {
  await signIn(page, "coach-validate");
  await page.goto("/coach");
  await page.getByRole("button", { name: "Simpan dan bikin rencana" }).click();
  for (const text of ["Pilih level kamu.", "Pilih modal yang siap kamu pakai.", "Pilih udah atau belum punya wallet.", "Pilih waktu per hari.", "Pilih tujuan kamu."]) {
    await expect(page.getByText(text)).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Rencana garapan kamu" })).toHaveCount(0);
});

test("the chat streams an answer with the project name as a link, and counts the message", async ({ page }) => {
  await signIn(page, "coach-chat");
  await fillProPlan(page);
  await expect(cards(page).first()).toBeVisible();
  await expect(page.getByTestId("coach-remaining")).toHaveText("Sisa 19/20 pesan hari ini");
  await expect(page.getByText("Bukan nasihat keuangan. Tetap DYOR.")).toBeVisible();

  await page.getByLabel("Pertanyaan kamu").fill("Mulai dari mana ya?");
  await page.getByRole("button", { name: "Kirim" }).click();
  const answer = page.getByTestId("coach-answer");
  await expect(answer).toContainText("Langkahnya ringan dan bisa dicicil pelan-pelan.");
  await expect(page.getByTestId("coach-remaining")).toHaveText("Sisa 18/20 pesan hari ini");
  const link = answer.getByRole("link");
  await expect(link).toHaveCount(1);
  expect(projects.map((p) => p.name)).toContain((await link.textContent()) ?? "");
  expect(await link.getAttribute("href")).toMatch(/^\/projects\/e2e-coach-/);
});

test("after the 20th message the Coach says the quota is spent and WIB reset time", async ({ page }) => {
  const email = await signIn(page, "coach-quota");
  await fillProPlan(page);
  await expect(cards(page).first()).toBeVisible();
  // The plan was message 1. Nineteen more answered messages of today fill the day.
  const userId = await userIdOf(email);
  const rows = Array.from({ length: 19 }, () => ({ id: randomUUID(), kind: "message", user_id: userId, replied: true }));
  const { error } = await adminClient().from("coach_usage").insert(rows);
  if (error) throw error;

  await page.getByLabel("Pertanyaan kamu").fill("Satu lagi");
  await page.getByRole("button", { name: "Kirim" }).click();
  // Not getByRole("alert") alone: Next's route announcer is an alert too.
  await expect(page.locator("p[role=alert]")).toHaveText("Jatah 20 pesan hari ini habis, reset jam 00.00 WIB.");
  await expect(page.getByTestId("coach-remaining")).toHaveText("Sisa 0/20 pesan hari ini");
  await expect(page.getByRole("button", { name: "Kirim" })).toBeDisabled();
});

test("the history lists the plan, opens it again and deletes it", async ({ page }) => {
  await signIn(page, "coach-history");
  await fillProPlan(page);
  await expect(cards(page).first()).toBeVisible();

  await page.goto("/coach");
  const row = page.locator(".coach-thread-list li").first();
  await expect(row).toContainText("Rencana garapan");
  await expect(cards(page)).toHaveCount(0);
  await row.getByRole("link", { name: "Buka" }).click();
  await expect(page).toHaveURL(/\/coach\?thread=/);
  await expect(cards(page)).toHaveCount(3);

  await page.getByRole("button", { name: "Hapus Rencana garapan" }).click();
  await expect(page.getByText("Belum ada percakapan.")).toBeVisible();
});

test("at 360 px the Coach page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, "coach-mobile");
  await page.goto("/coach");
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await fillProPlan(page);
  await expect(cards(page).first()).toBeVisible();
  await page.getByLabel("Pertanyaan kamu").fill("Halo");
  await page.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByTestId("coach-answer")).toContainText("Langkahnya ringan");
  expect(await overflow()).toBeLessThanOrEqual(0);
});
