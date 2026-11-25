export type JsonObject = Record<string, unknown>;

export interface ContactPoint extends JsonObject {
  name?: string;
  organizationUnit?: string;
  email?: string;
  phone?: string;
  url?: string;
}

export interface TemporalCoverage extends JsonObject {
  startDate?: string;
  endDate?: string;
  referenceDate?: string;
}

export interface DatasetAttribute extends JsonObject {
  name?: string;
  dataType?: string;
  description?: string;
  unit?: string;
  codeList?: string;
  mandatory?: boolean;
}

export interface DatasetSharedFields extends JsonObject {
  identifier?: string;
  title?: string;
  description?: string;
  publicationStatus?: string;
  accrualPeriodicity?: string;
  modified?: string;
  temporalCoverage?: TemporalCoverage;
  surveyMethod?: string;
  model?: string;
  attributes?: DatasetAttribute[];
  dataAvailableFrom?: string;
  furtherUses?: string;
  auxiliaryData?: string;
}

export interface Dataset extends DatasetSharedFields {
  accessLevel?: string;
  creatorRef?: string;
  contactPoint?: ContactPoint;
  themes?: string[];
  keywords?: string[];
}

export interface DatasetIssue extends DatasetSharedFields {
  __localIssueId?: string;
  __localIssueState?: LocalIssueState;
  issueLabel?: string;
  isCurrentIssue?: boolean;
}

export type IssueInheritedGroup =
  | "description"
  | "accrualPeriodicity"
  | "modified"
  | "temporalCoverage"
  | "surveyMethod"
  | "model"
  | "dataAvailableFrom"
  | "furtherUses";

export interface LocalIssueState extends JsonObject {
  inheritedGroups?: Partial<Record<IssueInheritedGroup, boolean>>;
  autoIdentifier?: boolean;
  autoTitle?: boolean;
}

export interface DatasetSeries extends Dataset {
  issues?: DatasetIssue[];
}

export interface DatasetRootJson extends JsonObject {
  type: "Dataset";
  schemaVersion: string;
  dataset: Dataset;
}

export interface DatasetSeriesRootJson extends JsonObject {
  type: "DatasetSeries";
  schemaVersion: string;
  series: DatasetSeries;
}

export type EditableRootJson = DatasetRootJson | DatasetSeriesRootJson;
export type DraftKind = "dataset" | "series";
export type DatasetSourceType = "endpoint" | "file" | "new" | "indexeddb";
export type AppMode =
  | "empty"
  | "loading-from-endpoint"
  | "importing-file"
  | "editing-dataset"
  | "editing-series"
  | "validation-error";
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type ImportShape = "xtf";
export type ImportConflictAction = "open-existing" | "save-copy" | "overwrite";

export interface MetadataSource {
  label: string;
  indexUrl: string;
  version: string;
}

export interface OfficeCatalogEntry {
  identifier: string;
  name: string;
}

export interface MetadataSearchRecord {
  identifier: string;
  title: string;
  description: string;
  modified?: string;
  creatorRef?: string;
  organizationUnit?: string;
  keywords: string[];
  document: EditableRootJson;
}

export interface DatasetDraftRecord {
  id: string;
  draftKind: DraftKind;
  identifier: string;
  title: string;
  updatedAt: string;
  sourceType: DatasetSourceType;
  sourceLabel?: string;
  sourceUrl?: string;
  originalFileName?: string;
  schemaVersion: string;
  data: EditableRootJson;
  dirty: boolean;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface ValidationIssue {
  severity: "error" | "warning" | "success";
  code: string;
  path: string;
  message: string;
}

export interface ValidationGroup {
  id: string;
  title: string;
  scope: "series" | "issue";
  active?: boolean;
  issueId?: string;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

export interface IssueValidationSummary {
  issueId: string;
  label: string;
  title: string;
  isCurrentIssue: boolean;
  errorCount: number;
  warningCount: number;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  exportable: boolean;
  groups?: ValidationGroup[];
  issueSummaries?: IssueValidationSummary[];
}

export interface ImportPreview {
  draftKind: DraftKind;
  root: EditableRootJson;
  importShape: ImportShape;
  sourceType: DatasetSourceType;
  sourceLabel?: string;
  sourceUrl?: string;
  originalFileName?: string;
}

export interface ConflictResolutionContext {
  existingDraft: DatasetDraftRecord;
  preview: ImportPreview;
}
