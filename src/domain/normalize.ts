import { fixedAccessLevel, fixedPublicationStatus } from "../config/vocabularies";
import type {
  ContactPoint,
  Dataset,
  DatasetAttribute,
  DatasetIssue,
  DatasetRootJson,
  DatasetSeries,
  DatasetSeriesRootJson,
  DraftKind,
  EditableRootJson,
  ImportShape,
  JsonObject,
  LocalIssueState,
  TemporalCoverage
} from "./datasetTypes";
import {
  createLocalIssueState,
  deriveImportedIssueState,
  syncIssueFromSeriesDefaults
} from "./seriesIssues";

export const DEFAULT_SCHEMA_VERSION = "2026-05-23";

export class DatasetImportError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DatasetImportError";
    this.code = code;
  }
}

export function createEmptyDatasetRoot(): DatasetRootJson {
  return {
    type: "Dataset",
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    dataset: createEmptyDataset()
  };
}

export function createEmptyDatasetSeriesRoot(): DatasetSeriesRootJson {
  const series: DatasetSeries = {
    ...createEmptyDataset(),
    issues: []
  };

  return {
    type: "DatasetSeries",
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    series
  };
}

export function createEmptyDatasetIssue(
  series?: DatasetSeries,
  options: { isCurrentIssue?: boolean } = {}
): DatasetIssue {
  const issue: DatasetIssue = {
    ...createEmptyDatasetIssueFields(),
    __localIssueId: crypto.randomUUID(),
    __localIssueState: createLocalIssueState(),
    isCurrentIssue: options.isCurrentIssue ?? false
  };

  if (series) {
    syncIssueFromSeriesDefaults(series, issue);
  }

  return issue;
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDatasetRoot(value: unknown): value is DatasetRootJson {
  return isObject(value) && value.type === "Dataset" && isObject(value.dataset);
}

export function isDatasetSeriesRoot(value: unknown): value is DatasetSeriesRootJson {
  return isObject(value) && value.type === "DatasetSeries" && isObject(value.series);
}

export function isDatasetSeriesLike(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  return value.type === "DatasetSeries" || isObject(value.series) || Array.isArray(value.issues);
}

export function isDatasetIssueLike(value: unknown): boolean {
  if (!isObject(value)) {
    return false;
  }

  if ("issues" in value || "series" in value || "dataset" in value) {
    return false;
  }

  return "issueLabel" in value || "isCurrentIssue" in value;
}

export function getDraftKindFromRoot(root: EditableRootJson | unknown): DraftKind {
  return isDatasetSeriesRoot(root) ? "series" : "dataset";
}

export function getRootIdentifier(root: EditableRootJson): string {
  return isDatasetSeriesRoot(root) ? root.series.identifier ?? "" : root.dataset.identifier ?? "";
}

export function getRootTitle(root: EditableRootJson): string {
  return isDatasetSeriesRoot(root) ? root.series.title ?? "" : root.dataset.title ?? "";
}

export function normalizeImportedJson(
  input: unknown
): { root: EditableRootJson; importShape: ImportShape; draftKind: DraftKind } {
  if (!isObject(input)) {
    throw new DatasetImportError("invalid-structure", "Die Datei enthält kein gültiges Objekt.");
  }

  if ("series" in input) {
    assertCurrentFields(input, ["type", "schemaVersion", "series"], "Root");
    if (input.type !== "DatasetSeries") {
      throw new DatasetImportError("invalid-root-type", "Das Root-Objekt muss den Typ \"DatasetSeries\" haben.");
    }

    if (!isObject(input.series)) {
      throw new DatasetImportError("missing-series", "Das Root-Objekt enthält keine gültige Datensatzserie.");
    }

    const { schemaVersion, series } = input;
    return {
      draftKind: "series",
      importShape: "xtf",
      root: {
        type: "DatasetSeries",
        schemaVersion: typeof schemaVersion === "string" ? schemaVersion : DEFAULT_SCHEMA_VERSION,
        series: hydrateSeries(series)
      }
    };
  }

  if ("dataset" in input) {
    assertCurrentFields(input, ["type", "schemaVersion", "dataset"], "Root");
    if (input.type !== "Dataset") {
      throw new DatasetImportError("invalid-root-type", "Das Root-Objekt muss den Typ \"Dataset\" haben.");
    }

    if (!isObject(input.dataset)) {
      throw new DatasetImportError("missing-dataset", "Das Root-Objekt enthält kein gültiges Datenblatt.");
    }

    const { dataset, schemaVersion } = input;
    return {
      draftKind: "dataset",
      importShape: "xtf",
      root: {
        type: "Dataset",
        schemaVersion: typeof schemaVersion === "string" ? schemaVersion : DEFAULT_SCHEMA_VERSION,
        dataset: hydrateDataset(dataset)
      }
    };
  }

  if (isDatasetSeriesLike(input)) {
    return {
      draftKind: "series",
      importShape: "xtf",
      root: {
        type: "DatasetSeries",
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        series: hydrateSeries(input)
      }
    };
  }

  if (isDatasetIssueLike(input)) {
    throw new DatasetImportError(
      "dataset-issue",
      "Diese Datei enthält nur eine einzelne Ausgabe. Der Editor erwartet ein ganzes Datenblatt oder eine Datensatzserie."
    );
  }

  return {
    draftKind: "dataset",
    importShape: "xtf",
    root: {
      type: "Dataset",
      schemaVersion: DEFAULT_SCHEMA_VERSION,
      dataset: hydrateDataset(input)
    }
  };
}

export function cloneRootWithFixedMetadata(root: EditableRootJson): EditableRootJson {
  const cloned = JSON.parse(JSON.stringify(root)) as EditableRootJson;
  const series = isDatasetSeriesRoot(cloned) ? cloned.series : undefined;
  const dataset = cloned.type === "Dataset" ? cloned.dataset : cloned.series;
  dataset.accessLevel = fixedAccessLevel.value;
  dataset.publicationStatus = fixedPublicationStatus.value;

  for (const issue of series?.issues ?? []) {
    issue.publicationStatus = fixedPublicationStatus.value;
  }

  return cloned;
}

export function toExportRoot(root: EditableRootJson): EditableRootJson {
  const cloned = cloneRootWithFixedMetadata(root);

  if (!isDatasetSeriesRoot(cloned)) {
    return cloned;
  }

  cloned.series.issues = (cloned.series.issues ?? []).map((issue) => {
    const { __localIssueId, __localIssueState, ...rest } = issue;
    return rest;
  });

  return cloned;
}

function createEmptyDataset(): Dataset {
  return {
    identifier: "",
    title: "",
    description: "",
    accessLevel: fixedAccessLevel.value,
    publicationStatus: fixedPublicationStatus.value,
    creatorRef: "",
    contactPoint: {
      name: "",
      organizationUnit: "",
      email: "",
      phone: "",
      url: ""
    },
    themes: [],
    keywords: [],
    accrualPeriodicity: "",
    modified: "",
    temporalCoverage: {},
    surveyMethod: "",
    model: "",
    attributes: [],
    dataAvailableFrom: "",
    furtherUses: "",
    auxiliaryData: ""
  };
}

function createEmptyDatasetIssueFields(): DatasetIssue {
  return {
    identifier: "",
    title: "",
    description: "",
    issueLabel: "",
    isCurrentIssue: false,
    publicationStatus: fixedPublicationStatus.value,
    accrualPeriodicity: "",
    modified: "",
    temporalCoverage: {},
    surveyMethod: "",
    model: "",
    attributes: [],
    dataAvailableFrom: "",
    furtherUses: "",
    auxiliaryData: ""
  };
}

function hydrateDataset(dataset: JsonObject, isSeries = false): Dataset {
  assertCurrentFields(dataset, isSeries ? [...datasetFields, "issues"] : datasetFields, isSeries ? "DatasetSeries" : "Dataset");

  return {
    identifier: textValue(dataset.identifier),
    title: textValue(dataset.title),
    description: textValue(dataset.description),
    accessLevel: fixedAccessLevel.value,
    publicationStatus: fixedPublicationStatus.value,
    creatorRef: textValue(dataset.creatorRef),
    contactPoint: hydrateContactPoint(dataset.contactPoint),
    themes: Array.isArray(dataset.themes) ? dataset.themes.filter(isString) : [],
    keywords: Array.isArray(dataset.keywords) ? dataset.keywords.filter(isString) : [],
    accrualPeriodicity: textValue(dataset.accrualPeriodicity),
    modified: textValue(dataset.modified),
    temporalCoverage: hydrateTemporalCoverage(dataset.temporalCoverage),
    surveyMethod: textValue(dataset.surveyMethod),
    model: textValue(dataset.model),
    attributes: Array.isArray(dataset.attributes) ? dataset.attributes.filter(isObject).map(hydrateAttribute) : [],
    dataAvailableFrom: textValue(dataset.dataAvailableFrom),
    furtherUses: textValue(dataset.furtherUses),
    auxiliaryData: textValue(dataset.auxiliaryData)
  };
}

function hydrateSeries(series: JsonObject): DatasetSeries {
  const hydratedSeries: DatasetSeries = {
    ...hydrateDataset(series, true),
    issues: []
  };

  hydratedSeries.issues = Array.isArray(series.issues)
    ? series.issues.filter(isObject).map((entry) => hydrateIssue(entry, hydratedSeries))
    : [];

  return hydratedSeries;
}

function hydrateIssue(issue: JsonObject, series?: DatasetSeries): DatasetIssue {
  assertCurrentFields(issue, issueFields, "DatasetIssue");

  const hydratedIssue: DatasetIssue = {
    identifier: textValue(issue.identifier),
    title: textValue(issue.title),
    description: textValue(issue.description),
    publicationStatus: fixedPublicationStatus.value,
    accrualPeriodicity: textValue(issue.accrualPeriodicity),
    modified: textValue(issue.modified),
    temporalCoverage: hydrateTemporalCoverage(issue.temporalCoverage),
    surveyMethod: textValue(issue.surveyMethod),
    model: textValue(issue.model),
    attributes: Array.isArray(issue.attributes) ? issue.attributes.filter(isObject).map(hydrateAttribute) : [],
    dataAvailableFrom: textValue(issue.dataAvailableFrom),
    furtherUses: textValue(issue.furtherUses),
    auxiliaryData: textValue(issue.auxiliaryData),
    issueLabel: textValue(issue.issueLabel),
    isCurrentIssue: issue.isCurrentIssue === true,
    __localIssueId: typeof issue.__localIssueId === "string" ? issue.__localIssueId : crypto.randomUUID(),
    __localIssueState: hydrateLocalIssueState(issue.__localIssueState, issue)
  };

  if (series) {
    syncIssueFromSeriesDefaults(series, hydratedIssue);
  }

  return hydratedIssue;
}

function hydrateContactPoint(value: unknown): ContactPoint {
  const contactPoint = isObject(value) ? value : {};
  return {
    name: textValue(contactPoint.name),
    organizationUnit: textValue(contactPoint.organizationUnit),
    email: textValue(contactPoint.email),
    phone: textValue(contactPoint.phone),
    url: textValue(contactPoint.url)
  };
}

function hydrateAttribute(value: JsonObject): DatasetAttribute {
  return {
    name: typeof value.name === "string" ? value.name : "",
    dataType: typeof value.dataType === "string" ? value.dataType : "",
    description: typeof value.description === "string" ? value.description : "",
    unit: typeof value.unit === "string" ? value.unit : "",
    codeList: typeof value.codeList === "string" ? value.codeList : "",
    mandatory: typeof value.mandatory === "boolean" ? value.mandatory : false
  };
}

function hydrateTemporalCoverage(value: unknown): TemporalCoverage {
  const coverage = isObject(value) ? value : {};
  return {
    startDate: textValue(coverage.startDate),
    endDate: textValue(coverage.endDate),
    referenceDate: textValue(coverage.referenceDate)
  };
}

function hydrateLocalIssueState(value: unknown, source: JsonObject): LocalIssueState {
  return isObject(value) ? createLocalIssueState(value as Partial<LocalIssueState>) : deriveImportedIssueState(source);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const datasetFields = [
  "identifier",
  "title",
  "description",
  "accessLevel",
  "publicationStatus",
  "creatorRef",
  "contactPoint",
  "themes",
  "keywords",
  "accrualPeriodicity",
  "modified",
  "temporalCoverage",
  "surveyMethod",
  "attributes",
  "model",
  "dataAvailableFrom",
  "furtherUses",
  "auxiliaryData"
];

const issueFields = [
  "identifier",
  "title",
  "description",
  "issueLabel",
  "isCurrentIssue",
  "publicationStatus",
  "accrualPeriodicity",
  "modified",
  "temporalCoverage",
  "surveyMethod",
  "attributes",
  "model",
  "dataAvailableFrom",
  "furtherUses",
  "auxiliaryData",
  "__localIssueId",
  "__localIssueState"
];

function assertCurrentFields(value: JsonObject, allowedFields: string[], context: string): void {
  const unsupportedField = Object.keys(value).find((field) => !allowedFields.includes(field));
  if (unsupportedField) {
    throw new DatasetImportError(
      "unsupported-field",
      `Das Feld "${unsupportedField}" in ${context} gehört nicht zum aktuellen Datenmodell.`
    );
  }
}
