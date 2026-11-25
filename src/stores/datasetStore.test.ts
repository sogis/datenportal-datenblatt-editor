import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createEmptyDatasetRoot, isDatasetRoot } from "../domain/normalize";
import type { DatasetDraftRecord, ImportPreview, SettingRecord } from "../domain/datasetTypes";

const repositoryState = vi.hoisted(() => ({
  drafts: new Map<string, DatasetDraftRecord>(),
  settings: new Map<string, SettingRecord["value"]>(),
  saveCalls: [] as DatasetDraftRecord[],
  saveDraftGate: null as Promise<void> | null
}));

vi.mock("../services/datasetRepository", () => {
  class MockDatasetRepository {
    async listDrafts(): Promise<DatasetDraftRecord[]> {
      return Array.from(repositoryState.drafts.values()).map(cloneDraft);
    }

    async getDraft(id: string): Promise<DatasetDraftRecord | undefined> {
      const draft = repositoryState.drafts.get(id);
      return draft ? cloneDraft(draft) : undefined;
    }

    async saveDraft(draft: DatasetDraftRecord): Promise<DatasetDraftRecord> {
      repositoryState.saveCalls.push(cloneDraft(draft));
      if (repositoryState.saveDraftGate) {
        await repositoryState.saveDraftGate;
      }
      const cloned = cloneDraft(draft);
      repositoryState.drafts.set(cloned.id, cloned);
      return cloneDraft(cloned);
    }

    async deleteDraft(id: string): Promise<void> {
      repositoryState.drafts.delete(id);
    }

    async deleteAllDrafts(): Promise<void> {
      repositoryState.drafts.clear();
    }

    async duplicateDraft(id: string): Promise<DatasetDraftRecord> {
      const original = repositoryState.drafts.get(id);
      if (!original) {
        throw new Error("Der lokale Entwurf konnte nicht gefunden werden.");
      }

      const copy = cloneDraft({
        ...original,
        id: crypto.randomUUID(),
        updatedAt: new Date().toISOString()
      });
      repositoryState.drafts.set(copy.id, copy);
      return cloneDraft(copy);
    }

    async findByIdentifier(
      identifier: string,
      draftKind: DatasetDraftRecord["draftKind"],
      excludeId?: string
    ): Promise<DatasetDraftRecord | undefined> {
      for (const draft of repositoryState.drafts.values()) {
        if (draft.identifier === identifier && draft.draftKind === draftKind && draft.id !== excludeId) {
          return cloneDraft(draft);
        }
      }

      return undefined;
    }

    async getSetting<T = unknown>(key: string): Promise<T | undefined> {
      return repositoryState.settings.get(key) as T | undefined;
    }

    async setSetting(key: string, value: unknown): Promise<void> {
      repositoryState.settings.set(key, value);
    }
  }

  return { DatasetRepository: MockDatasetRepository };
});

import { useDatasetStore } from "./datasetStore";

describe("datasetStore fixed metadata", () => {
  beforeEach(() => {
    repositoryState.drafts.clear();
    repositoryState.settings.clear();
    repositoryState.saveCalls.length = 0;
    repositoryState.saveDraftGate = null;
    setActivePinia(createPinia());
  });

  it("sets fixed metadata when reopening and saving a legacy draft", async () => {
    const root = createEmptyDatasetRoot();
    root.dataset.accessLevel = "restricted";
    root.dataset.publicationStatus = "draft";

    const draft: DatasetDraftRecord = {
      id: "draft-1",
      draftKind: "dataset",
      identifier: "so.test",
      title: "Test",
      updatedAt: "2026-06-03T12:00:00.000Z",
      sourceType: "indexeddb",
      schemaVersion: root.schemaVersion,
      data: root,
      dirty: false
    };

    repositoryState.drafts.set(draft.id, cloneDraft(draft));

    const store = useDatasetStore();
    const openedDraft = await store.openDraft(draft.id);

    expect(openedDraft).not.toBeNull();
    expect(store.currentDraft).not.toBeNull();
    const fixedMetadata = { accessLevel: "open", publicationStatus: "published" };
    expect(openedDraft?.data).toMatchObject({ dataset: fixedMetadata });
    expect(store.currentDraft?.data).toMatchObject({ dataset: fixedMetadata });

    await store.persistCurrentDraft();
    expect(repositoryState.drafts.get(draft.id)?.data).toMatchObject({ dataset: fixedMetadata });
  });

  it("sets fixed metadata before persisting an import", async () => {
    const store = useDatasetStore();
    const root = createEmptyDatasetRoot();
    root.dataset.accessLevel = "internal";
    root.dataset.publicationStatus = "in_review";

    const preview: ImportPreview = {
      draftKind: "dataset",
      root,
      importShape: "xtf",
      sourceType: "file",
      sourceLabel: "Datei test.xtf",
      originalFileName: "test.xtf"
    };

    const persistedDraft = await store.stageImport(preview);

    expect(persistedDraft).not.toBeNull();
    expect(store.currentDraft).not.toBeNull();
    const fixedMetadata = { accessLevel: "open", publicationStatus: "published" };
    expect(persistedDraft?.data).toMatchObject({ dataset: fixedMetadata });
    expect(store.currentDraft?.data).toMatchObject({ dataset: fixedMetadata });
  });
});

describe("datasetStore autosave", () => {
  beforeEach(() => {
    repositoryState.drafts.clear();
    repositoryState.settings.clear();
    repositoryState.saveCalls.length = 0;
    repositoryState.saveDraftGate = null;
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces dirty changes into one save after the quiet period", async () => {
    vi.useFakeTimers();
    const store = useDatasetStore();
    await store.createNewDraft();
    repositoryState.saveCalls.length = 0;

    store.markDirty();
    await vi.advanceTimersByTimeAsync(500);
    store.markDirty();
    await vi.advanceTimersByTimeAsync(499);

    expect(repositoryState.saveCalls).toHaveLength(0);
    expect(store.saveState).toBe("dirty");

    await vi.advanceTimersByTimeAsync(251);

    expect(repositoryState.saveCalls).toHaveLength(1);
    expect(store.saveState).toBe("saved");
  });

  it("keeps newer edits when a save is still in flight", async () => {
    vi.useFakeTimers();
    const store = useDatasetStore();
    await store.createNewDraft();
    repositoryState.saveCalls.length = 0;

    let releaseSave!: () => void;
    repositoryState.saveDraftGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });

    if (!store.currentDraft || !isDatasetRoot(store.currentDraft.data)) {
      throw new Error("Expected an open dataset draft");
    }
    store.currentDraft.data.dataset.identifier = "old-value";
    store.markDirty();
    await vi.advanceTimersByTimeAsync(750);
    expect(repositoryState.saveCalls).toHaveLength(1);
    expect(store.saveState).toBe("saving");

    if (!store.currentDraft || !isDatasetRoot(store.currentDraft.data)) {
      throw new Error("Expected an open dataset draft");
    }
    store.currentDraft.data.dataset.identifier = "latest-value";
    store.markDirty();
    releaseSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(store.currentDraft?.data).toMatchObject({ dataset: { identifier: "latest-value" } });
    expect(store.saveState).toBe("dirty");

    repositoryState.saveDraftGate = null;
    await vi.advanceTimersByTimeAsync(750);

    expect(repositoryState.saveCalls).toHaveLength(2);
    expect(repositoryState.drafts.get(store.currentDraft!.id)?.data).toMatchObject({
      dataset: { identifier: "latest-value" }
    });
    expect(store.saveState).toBe("saved");
  });
});

function cloneDraft(draft: DatasetDraftRecord): DatasetDraftRecord {
  return JSON.parse(JSON.stringify(draft)) as DatasetDraftRecord;
}
