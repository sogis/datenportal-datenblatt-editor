import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/vue";
import userEvent from "@testing-library/user-event";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeCatalogEntry } from "../domain/datasetTypes";
import { createEmptyDatasetRoot } from "../domain/normalize";
import DatasetForm from "./DatasetForm.vue";

const loadOfficeCatalog = vi.fn<(url: string) => Promise<OfficeCatalogEntry[]>>();

vi.mock("../services/endpointLoader", () => ({
  loadOfficeCatalog: (url: string) => loadOfficeCatalog(url)
}));

describe("DatasetForm", () => {
  beforeEach(() => {
    loadOfficeCatalog.mockResolvedValue([
      { identifier: "ch.so.afu", name: "Amt für Umwelt" },
      { identifier: "ch.so.agi", name: "Amt für Geoinformation" }
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("preserves keyword separators while typing and normalizes the dataset values", async () => {
    const user = userEvent.setup();
    const dataset = createEmptyDatasetRoot().dataset;

    render(DatasetForm, {
      props: {
        dataset
      }
    });

    const keywordsInput = screen.getByLabelText("Keywords");

    await user.type(keywordsInput, "Wasser, ");

    expect(keywordsInput).toHaveValue("Wasser, ");
    expect(dataset.keywords).toEqual(["Wasser"]);

    await user.type(keywordsInput, "Nitrat");

    expect(keywordsInput).toHaveValue("Wasser, Nitrat");
    expect(dataset.keywords).toEqual(["Wasser", "Nitrat"]);
    expect(screen.getByText("Wasser")).toBeInTheDocument();
    expect(screen.getByText("Nitrat")).toBeInTheDocument();

    await fireEvent.blur(keywordsInput);

    expect(keywordsInput).toHaveValue("Wasser, Nitrat");
  });

  it("marks the contact url as required and renders the multi-column theme list", () => {
    const dataset = createEmptyDatasetRoot().dataset;
    const { container } = render(DatasetForm, {
      props: {
        dataset
      }
    });

    expect(screen.getByLabelText("URL")).toBeInTheDocument();
    expect(container.querySelector(".checkbox-list--themes")).not.toBeNull();
  });

  it("renders and binds the data model field", async () => {
    const dataset = createEmptyDatasetRoot().dataset;

    const { getByLabelText } = render(
      defineComponent({
        components: { DatasetForm },
        setup() {
          return { dataset };
        },
        template: '<DatasetForm :dataset="dataset" />'
      })
    );

    const modelInput = getByLabelText("Datenmodell");

    await fireEvent.update(modelInput, "SO_AGI_DataCatalog_Base_20260529");

    expect(modelInput).toHaveValue("SO_AGI_DataCatalog_Base_20260529");
    expect(dataset.model).toBe("SO_AGI_DataCatalog_Base_20260529");
  });

  it("shows fixed access and publication values in read-only fields", async () => {
    const user = userEvent.setup();
    const dataset = createEmptyDatasetRoot().dataset;

    render(DatasetForm, {
      props: {
        dataset
      }
    });

    const accessLevel = screen.getByLabelText("Zugänglichkeit *");
    const publicationStatus = screen.getByLabelText("Publikationsstatus *");

    expect(accessLevel).toHaveAttribute("readonly");
    expect(publicationStatus).toHaveAttribute("readonly");
    await user.type(accessLevel, "Eingeschränkt");
    await user.type(publicationStatus, "Entwurf");
    expect(accessLevel).toHaveValue("Öffentlich, frei zugänglich");
    expect(publicationStatus).toHaveValue("Veröffentlicht");
    expect(dataset).toMatchObject({ accessLevel: "open", publicationStatus: "published" });
  });

  it("renders the data owner select and stores the selected identifier", async () => {
    const dataset = createEmptyDatasetRoot().dataset;

    render(DatasetForm, {
      props: {
        dataset
      }
    });

    const ownerSelect = screen.getByLabelText("Datenherr *");

    await waitFor(() =>
      expect(within(ownerSelect).getByRole("option", { name: "Amt für Umwelt" })).toBeInTheDocument()
    );
    expect(within(ownerSelect).getByRole("option", { name: "Amt für Geoinformation" })).toBeInTheDocument();

    await fireEvent.update(ownerSelect, "ch.so.agi");

    expect(ownerSelect).toHaveValue("ch.so.agi");
    expect(dataset.creatorRef).toBe("ch.so.agi");
  });

  it("clears an unknown prefilled data owner after catalog load", async () => {
    const dataset = createEmptyDatasetRoot().dataset;
    dataset.creatorRef = "ch.so.unknown";

    render(DatasetForm, {
      props: {
        dataset
      }
    });

    await waitFor(() => expect(dataset.creatorRef).toBe(""));
  });

  it("disables the data owner select and shows an inline error on catalog load failure", async () => {
    loadOfficeCatalog.mockRejectedValueOnce(new Error("Der Datenherr-Katalog konnte nicht geladen werden."));

    const dataset = createEmptyDatasetRoot().dataset;

    render(DatasetForm, {
      props: {
        dataset
      }
    });

    const ownerSelect = screen.getByLabelText("Datenherr *");

    await waitFor(() =>
      expect(screen.getByText("Der Datenherr-Katalog konnte nicht geladen werden.")).toBeInTheDocument()
    );
    expect(ownerSelect).toBeDisabled();
  });

  it("updates a prefilled top-level field through the form", async () => {
    const dataset = createEmptyDatasetRoot().dataset;
    dataset.model = "SO_AGI_Initial";

    const { getByLabelText } = render(
      defineComponent({
        components: { DatasetForm },
        setup() {
          return { dataset };
        },
        template: '<DatasetForm :dataset="dataset" />'
      })
    );

    const modelInput = getByLabelText("Datenmodell");

    expect(modelInput).toHaveValue("SO_AGI_Initial");

    await fireEvent.update(modelInput, "SO_AGI_Updated");

    expect(dataset.model).toBe("SO_AGI_Updated");
  });
});
