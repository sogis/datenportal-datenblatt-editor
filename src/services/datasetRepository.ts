import Dexie, { type Table } from "dexie";
import type { DatasetDraftRecord, SettingRecord } from "../domain/datasetTypes";
import { cloneRootWithFixedMetadata, getDraftKindFromRoot, normalizeImportedJson } from "../domain/normalize";

class DatasetEditorDatabase extends Dexie {
  datasets!: Table<DatasetDraftRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      datasets: "id,identifier,title,updatedAt,sourceType",
      settings: "key"
    });
    this.version(2)
      .stores({
        datasets: "id,identifier,title,updatedAt,sourceType,draftKind,[draftKind+identifier]",
        settings: "key"
      })
      .upgrade((tx) =>
        tx
          .table("datasets")
          .toCollection()
          .modify((draft: Partial<DatasetDraftRecord>) => {
            if (draft.data) {
              draft.draftKind = getDraftKindFromRoot(draft.data);
            }
          })
      );
    this.version(3)
      .stores({
        datasets: "id,identifier,title,updatedAt,sourceType,draftKind,[draftKind+identifier]",
        settings: "key"
      })
      .upgrade((tx) =>
        tx
          .table("datasets")
          .toCollection()
          .modify((draft: Partial<DatasetDraftRecord>) => {
            if (!draft.data) {
              return;
            }

            draft.data = normalizeImportedJson(draft.data).root;
            draft.draftKind = getDraftKindFromRoot(draft.data);
            draft.schemaVersion = draft.data.schemaVersion;
          })
      );
  }
}

export class DatasetRepository {
  private db: DatasetEditorDatabase;

  constructor(name = "datenblatt-editor") {
    this.db = new DatasetEditorDatabase(name);
  }

  async listDrafts(): Promise<DatasetDraftRecord[]> {
    const drafts = await this.db.datasets.toArray();
    return drafts
      .map((draft) => cloneDraft(draft))
      .sort((left, right) => {
        const updatedCompare = right.updatedAt.localeCompare(left.updatedAt);
        if (updatedCompare !== 0) {
          return updatedCompare;
        }
        return left.title.localeCompare(right.title, "de-CH");
      });
  }

  async getDraft(id: string): Promise<DatasetDraftRecord | undefined> {
    const draft = await this.db.datasets.get(id);
    return draft ? cloneDraft(draft) : undefined;
  }

  async saveDraft(draft: DatasetDraftRecord): Promise<DatasetDraftRecord> {
    const normalized = cloneDraft(draft);
    await this.db.datasets.put(normalized);
    return normalized;
  }

  async deleteDraft(id: string): Promise<void> {
    await this.db.datasets.delete(id);
  }

  async deleteAllDrafts(): Promise<void> {
    await this.db.datasets.clear();
  }

  async duplicateDraft(id: string): Promise<DatasetDraftRecord> {
    const original = await this.getDraft(id);
    if (!original) {
      throw new Error("Der lokale Entwurf konnte nicht gefunden werden.");
    }

    const copy: DatasetDraftRecord = {
      ...original,
      id: crypto.randomUUID(),
      sourceType: "indexeddb",
      sourceLabel: `Lokale Kopie von ${original.title || original.identifier || "Datensatz"}`,
      updatedAt: new Date().toISOString(),
      dirty: false
    };
    return this.saveDraft(copy);
  }

  async findByIdentifier(
    identifier: string,
    draftKind: DatasetDraftRecord["draftKind"],
    excludeId?: string
  ): Promise<DatasetDraftRecord | undefined> {
    if (!identifier.trim()) {
      return undefined;
    }

    const drafts = await this.db.datasets.where("[draftKind+identifier]").equals([draftKind, identifier]).toArray();
    const draft = drafts.find((entry) => entry.id !== excludeId);
    return draft ? cloneDraft(draft) : undefined;
  }

  async getSetting<T = unknown>(key: string): Promise<T | undefined> {
    const record = await this.db.settings.get(key);
    return record?.value as T | undefined;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.db.settings.put({ key, value });
  }
}

function cloneDraft(draft: DatasetDraftRecord): DatasetDraftRecord {
  return {
    ...draft,
    draftKind: draft.draftKind ?? getDraftKindFromRoot(draft.data),
    data: cloneRootWithFixedMetadata(draft.data)
  };
}
