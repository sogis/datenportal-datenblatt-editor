import { expect, test, type Locator, type Page } from "@playwright/test";

function actionCard(page: Page, heading: string) {
  return page.locator(".action-card").filter({ has: page.getByRole("heading", { name: heading }) });
}

async function expectFixedMetadata(page: Page): Promise<void> {
  const accessLevel = page.getByLabel("Zugänglichkeit *");
  const publicationStatus = page.getByLabel("Publikationsstatus *");
  await expect(accessLevel).toHaveValue("Öffentlich, frei zugänglich");
  await expect(publicationStatus).toHaveValue("Veröffentlicht");
  await expect(accessLevel).not.toBeEditable();
  await expect(publicationStatus).not.toBeEditable();
}

async function expectVerticalGap(first: Locator, second: Locator, expectedPx: number): Promise<void> {
  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();

  const gap = (secondBox?.y ?? 0) - ((firstBox?.y ?? 0) + (firstBox?.height ?? 0));
  expect(Math.round(gap)).toBe(expectedPx);
}

async function createLocalDraft(page: Page, expectedCount: number): Promise<void> {
  await actionCard(page, "Neues Datenblatt (einzelner Datensatz) anlegen")
    .getByRole("button", { name: "Neues Datenblatt anlegen" })
    .click();
  const contextBar = page.locator(".context-bar");
  await expect(contextBar).toContainText("Neues Datenblatt");
  await expect(contextBar).toHaveCSS("padding-top", "12px");
  await expect(contextBar).toHaveCSS("padding-left", "16px");
  await expect(contextBar).toHaveCSS("background-color", "rgb(231, 246, 236)");
  await expect(contextBar.locator(".status-pill")).toHaveCount(0);
  await expectFixedMetadata(page);
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page.locator(".context-bar")).toHaveCount(0);
  await expect(page.locator(".draft-card")).toHaveCount(expectedCount);
  await expect(page.locator(".draft-card").first()).toHaveCSS("border-radius", "4px");
  await expect(page.locator(".draft-card").first()).not.toContainText("Quelle:");
  await page.locator(".draft-card").first().getByRole("button", { name: "Öffnen", exact: true }).click();
  await expect(page.locator(".context-bar")).toContainText("Lokaler Entwurf");
  await page.getByRole("link", { name: "Start" }).click();
  await expect(page.locator(".context-bar")).toHaveCount(0);
  await expect(page.locator(".draft-card")).toHaveCount(expectedCount);
}

test("shows the simplified start screen", async ({ page }) => {
  await page.goto("/");

  const sourceCard = actionCard(page, "Metadaten von Quelle laden");
  const newDatasetCard = actionCard(page, "Neues Datenblatt (einzelner Datensatz) anlegen");
  const draftCard = actionCard(page, "Lokalen Entwurf öffnen");
  const primaryButton = sourceCard.getByRole("button", { name: "Quelle öffnen" });
  const secondaryButton = newDatasetCard.getByRole("button", { name: "Neues Datenblatt anlegen" });
  const activeTab = page.getByRole("link", { name: "Start" });
  const inactiveTab = page.getByRole("link", { name: "Datensatz" });

  await expect(page.getByRole("heading", { name: "Datenportal: Datenblatt-Editor" })).toBeVisible();
  await expect(page.locator(".action-card")).toHaveCount(6);
  await expect(newDatasetCard).toHaveCSS("border-radius", "4px");
  await expect(page.locator(".action-grid .button--primary")).toHaveCount(1);
  await expect(primaryButton).toBeVisible();
  await expect(primaryButton).toBeDisabled();
  await expect(sourceCard).toHaveClass(/action-card--disabled/);
  await expect(sourceCard).toHaveAttribute("aria-disabled", "true");
  await expect(sourceCard).toContainText("Der Quellenimport ist derzeit deaktiviert.");
  await expect(sourceCard.locator(".button--primary")).toHaveCount(1);
  await expect(newDatasetCard.locator(".button--primary")).toHaveCount(0);
  await expect(draftCard.getByRole("button", { name: "Zu den Entwürfen" })).toBeVisible();
  await expect(draftCard.getByRole("button", { name: "Neues Datenblatt anlegen" })).toHaveCount(0);
  await expect(page.locator(".eyebrow")).toHaveCount(0);
  await expect(page.locator(".toolbar-actions")).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(primaryButton).toHaveCSS("background-color", "rgb(217, 224, 230)");
  await expect(primaryButton).toHaveCSS("border-color", "rgb(217, 224, 230)");
  await expect(primaryButton).toHaveCSS("border-radius", "4px");
  await expect(secondaryButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(secondaryButton).toHaveCSS("border-color", "rgb(210, 10, 17)");
  await expect(secondaryButton).toHaveCSS("color", "rgb(210, 10, 17)");
  await secondaryButton.hover();
  await expect(secondaryButton).toHaveCSS("text-decoration-line", "none");
  await expect(secondaryButton).toHaveCSS("border-color", "rgb(184, 15, 23)");
  await expect(secondaryButton).toHaveCSS("color", "rgb(184, 15, 23)");
  await expect(activeTab).toHaveCSS("border-bottom-color", "rgb(210, 10, 17)");
  await expect(activeTab).toHaveCSS("text-decoration-line", "none");
  await expect(inactiveTab).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(inactiveTab).toHaveAttribute("aria-disabled", "true");
  await expect(inactiveTab).toHaveCSS("text-decoration-line", "none");
  await page.evaluate(() => {
    const fixture = document.createElement("p");
    fixture.id = "inline-link-fixture";
    fixture.innerHTML = '<a id="inline-link" href="#inline-link-fixture">Mehr erfahren</a>';
    document.body.appendChild(fixture);
  });
  const inlineLink = page.locator("#inline-link");
  await expect(inlineLink).toHaveCSS("text-decoration-line", "underline");
  await expect(inlineLink).toHaveCSS("color", "rgb(47, 72, 88)");
  await inlineLink.hover();
  await expect(inlineLink).toHaveCSS("text-decoration-line", "underline");
  await expect(inlineLink).toHaveCSS("color", "rgb(210, 10, 17)");
  await expect(page.locator(".empty-state h3")).toHaveCSS("margin-top", "0px");
});

test("creates and navigates a dataset series workspace", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      runtimeErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    runtimeErrors.push(error.message);
  });

  await page.goto("/");

  await actionCard(page, "Neues Datenblatt (Serie) anlegen")
    .getByRole("button", { name: "Neues Datenblatt anlegen" })
    .click();

  await expect(page.locator(".context-bar")).toContainText("Neue Datensatzserie");
  await expect(page.getByRole("link", { name: "Serie", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ausgaben", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vorschau", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Datenblatt exportieren" })).toBeDisabled();

  await expectFixedMetadata(page);
  await page.getByLabel("Identifier *").fill("ch.foo");
  await page.getByLabel("Titel *").fill("Ch Foo");
  await page.getByLabel("Beschreibung *").fill("Serienbeschreibung");
  await page.getByLabel("Datenherr *").selectOption("ch.so.agi");
  await page.getByLabel("E-Mail / URI *").fill("mailto:kontakt@example.org");
  await page.getByText("Bevölkerung").click();
  await page.getByLabel("Modified *").fill("2026-05-01");
  await page.getByLabel("Hilfsdaten").fill("Seriengrundlage");

  const rangeRadio = page.getByLabel("Zeitraum");
  const referenceRadio = page.getByLabel("Stichtag");
  await rangeRadio.click();
  await expect(rangeRadio).toBeChecked();
  await referenceRadio.click();
  await expect(referenceRadio).toBeChecked();
  await expect(page.getByLabel("Kein Zeitbezug")).not.toBeChecked();

  await page.getByRole("link", { name: "Ausgaben", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ausgaben", exact: true })).toBeVisible();
  await expect(page.getByText("Serienkontext")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ausgabe hinzufügen" })).toBeVisible();
  await expect(page.getByText("Noch keine Ausgaben erfasst")).toBeVisible();
  await expect(page.getByText("IssueLabel ist ein Pflichtfeld.")).toHaveCount(0);

  await page.getByRole("button", { name: "Ausgabe hinzufügen" }).click();
  await expectFixedMetadata(page);

  const issueListBox = await page.locator(".series-issue-list").boundingBox();
  const issueEditorBox = await page.locator(".series-workspace__editor").boundingBox();
  expect(issueListBox?.y ?? 0).toBeLessThan(issueEditorBox?.y ?? 0);

  await page.getByLabel("IssueLabel *").fill("2026");
  await expect(page.getByLabel("Identifier *")).toHaveValue("ch.foo_2026");
  await expect(page.getByLabel("Titel")).toHaveValue("Ch Foo 2026");
  await page.getByLabel("Hilfsdaten").fill("Ausgabengrundlage");
  const selectedIssueCard = page.locator('.series-issue-card[data-selected="true"]');
  await expect(selectedIssueCard).toHaveCount(1);
  await expect(selectedIssueCard).toHaveCSS("background-color", "rgb(232, 242, 251)");
  await expect(selectedIssueCard).toHaveCSS("border-color", "rgb(185, 215, 239)");
  await expect(selectedIssueCard).toContainText("Keine offenen Probleme");
  await expect(page.getByText("OK")).toHaveCount(0);

  await page.getByRole("button", { name: "Ausgabe hinzufügen" }).click();
  await expect(page.locator(".series-issue-card")).toHaveCount(2);

  await page.locator(".series-issue-card").nth(1).getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.locator(".series-issue-card")).toHaveCount(1);
  await page.locator(".series-issue-card").first().getByRole("button", { name: "Löschen", exact: true }).click();
  await expect(page.locator(".series-issue-card")).toHaveCount(0);
  await expect(page.getByText("Noch keine Ausgaben erfasst")).toBeVisible();
  await expect(page).toHaveURL(/\/issues$/);

  await page.getByRole("button", { name: "Ausgabe hinzufügen" }).click();
  await page.getByLabel("IssueLabel *").fill("2026");
  await page.getByLabel("Hilfsdaten").fill("Ausgabengrundlage");

  await page.getByRole("link", { name: "Serie", exact: true }).click();
  await page.getByLabel("Titel *").fill("Ch Bar");
  await page.getByRole("link", { name: "Ausgaben", exact: true }).click();
  await expect(page.getByLabel("Titel")).toHaveValue("Ch Bar 2026");

  await page.getByRole("link", { name: "Vorschau", exact: true }).click();
  await expect(page.locator(".preview-panel")).toContainText("<DatasetSeries");
  await expect(page.locator(".preview-panel")).toContainText("<accessLevel>open</accessLevel>");
  await expect(page.locator(".preview-panel")).toContainText("<publicationStatus>published</publicationStatus>");
  expect(runtimeErrors.filter((message) => message.includes("Maximum recursive updates exceeded"))).toEqual([]);
});

test("shows the current radius on empty state and file import surfaces", async ({ page }) => {
  await page.goto("/");

  await actionCard(page, "Datenblatt (einzelner Datensatz) importieren")
    .getByRole("button", { name: "Datenblatt importieren" })
    .click();
  await expect(page.locator(".dialog")).toHaveCSS("border-radius", "4px");
  await expect(page.locator(".drop-zone")).toHaveCSS("border-radius", "4px");
  await page.getByRole("button", { name: "Schließen" }).click();

  await createLocalDraft(page, 1);
  await page.getByRole("link", { name: "Datensatz" }).click();
  const emptyState = page.locator(".empty-state");
  await expect(emptyState).toContainText("Noch keine Datensatzattribute");
  await expect(emptyState).toHaveCSS("border-radius", "4px");
});

test("deletes all local drafts at once", async ({ page }) => {
  await page.goto("/");

  await createLocalDraft(page, 1);
  await createLocalDraft(page, 2);

  await page.getByRole("button", { name: "Alle löschen" }).click();

  const dialog = page.locator(".dialog--narrow");
  await expect(dialog).toContainText("Möchten Sie wirklich alle 2 lokalen Entwürfe löschen?");
  await expect(dialog).toContainText("Auch der aktuell geladene Entwurf wird gelöscht und der Editor zurückgesetzt.");

  await dialog.getByRole("button", { name: "Löschen" }).click();

  await expect(page.getByRole("heading", { name: "Noch keine lokalen Entwürfe" })).toBeVisible();
  await expect(page.locator(".context-bar")).toHaveCount(0);
  await expect(page.locator(".draft-card")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Datensatz" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "Vorschau" })).toHaveAttribute("href", "/");
});

test("cancels bulk deletion without changing drafts", async ({ page }) => {
  await page.goto("/");

  await createLocalDraft(page, 1);
  await createLocalDraft(page, 2);

  await page.getByRole("button", { name: "Alle löschen" }).click();
  await page.getByRole("button", { name: "Abbrechen" }).click();

  await expect(page.getByRole("heading", { name: "Lokale Entwürfe" })).toBeVisible();
  await expect(page.locator(".draft-card")).toHaveCount(2);
  await expect(page.locator(".context-bar")).toHaveCount(0);
  await expect(page.locator(".dialog--narrow")).toHaveCount(0);
});
