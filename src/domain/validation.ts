import Ajv from "ajv";
import addFormats from "ajv-formats";
import type {
  Dataset,
  DatasetAttribute,
  DatasetIssue,
  DatasetRootJson,
  DatasetSeries,
  DatasetSeriesRootJson,
  EditableRootJson,
  IssueValidationSummary,
  JsonObject,
  ValidationGroup,
  ValidationIssue,
  ValidationResult
} from "./datasetTypes";
import {
  DEFAULT_SCHEMA_VERSION,
  isDatasetIssueLike,
  isDatasetSeriesLike,
  isDatasetSeriesRoot,
  isObject
} from "./normalize";
import { createEffectiveIssue, isIssueGroupInherited } from "./seriesIssues";
import {
  accessLevelOptions,
  accrualPeriodicityOptions,
  publicationStatusOptions,
  themeOptions
} from "../config/vocabularies";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);

const datasetRootSchema = {
  type: "object",
  required: ["type", "dataset"],
  additionalProperties: true,
  properties: {
    type: { const: "Dataset" },
    schemaVersion: { type: "string" },
    dataset: {
      type: "object",
      additionalProperties: true
    }
  }
} as const;

const nakedDatasetSchema = {
  type: "object",
  additionalProperties: true
} as const;

const datasetSeriesRootSchema = {
  type: "object",
  required: ["type", "series"],
  additionalProperties: true,
  properties: {
    type: { const: "DatasetSeries" },
    schemaVersion: { type: "string" },
    series: {
      type: "object",
      additionalProperties: true
    }
  }
} as const;

const nakedDatasetSeriesSchema = {
  type: "object",
  required: ["issues"],
  additionalProperties: true,
  properties: {
    type: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true
      }
    }
  }
} as const;

const validateDatasetRootSchema = ajv.compile(datasetRootSchema);
const validateNakedDatasetSchema = ajv.compile(nakedDatasetSchema);
const validateDatasetSeriesRootSchema = ajv.compile(datasetSeriesRootSchema);
const validateNakedDatasetSeriesSchema = ajv.compile(nakedDatasetSeriesSchema);

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const accessLevelValues = new Set(accessLevelOptions.map((option) => option.value).filter(Boolean));
const accrualPeriodicityValues = new Set(accrualPeriodicityOptions.map((option) => option.value).filter(Boolean));
const publicationStatusValues = new Set(publicationStatusOptions.map((option) => option.value).filter(Boolean));
const themeValues = new Set(themeOptions.map((option) => option.value));

export function validateImportedStructure(input: unknown): ValidationIssue[] {
  if (!isObject(input)) {
    return [issue("error", "invalid-structure", "$", "Die Datei enthält kein gültiges Datenblatt-Objekt.")];
  }

  if (isDatasetIssueLike(input) && !isDatasetSeriesLike(input)) {
    return [
      issue(
        "error",
        "dataset-issue",
        "$",
        "Diese Datei enthält nur eine einzelne Ausgabe. Der Editor erwartet ein ganzes Datenblatt oder eine Datensatzserie."
      )
    ];
  }

  if (isDatasetSeriesLike(input)) {
    const ok = "series" in input ? validateDatasetSeriesRootSchema(input) : validateNakedDatasetSeriesSchema(input);
    if (ok) {
      return [];
    }

    const errors = ("series" in input ? validateDatasetSeriesRootSchema.errors : validateNakedDatasetSeriesSchema.errors) ?? [];
    return errors.map((entry) =>
      issue(
        "error",
        "schema",
        entry.instancePath || "$",
        entry.message ?? "Die Struktur der Datensatzserie ist ungültig."
      )
    );
  }

  const ok = "dataset" in input ? validateDatasetRootSchema(input) : validateNakedDatasetSchema(input);
  if (ok) {
    return [];
  }

  const errors = ("dataset" in input ? validateDatasetRootSchema.errors : validateNakedDatasetSchema.errors) ?? [];
  return errors.map((entry) =>
    issue("error", "schema", entry.instancePath || "$", entry.message ?? "Die Struktur des Datenblatts ist ungültig.")
  );
}

export function validateEditableRoot(root: EditableRootJson, activeIssueId?: string): ValidationResult {
  return isDatasetSeriesRoot(root) ? validateDatasetSeries(root, activeIssueId) : validateDataset(root);
}

export function validateDataset(root: DatasetRootJson): ValidationResult {
  const issues: ValidationIssue[] = [];
  const dataset = root.dataset;

  if (root.schemaVersion !== DEFAULT_SCHEMA_VERSION) {
    issues.push(
      issue(
        "warning",
        "schema-version",
        "$.schemaVersion",
        `Schema-Version ${root.schemaVersion} weicht vom MVP-Export ${DEFAULT_SCHEMA_VERSION} ab.`
      )
    );
  }

  validateDatasetMetadata(issues, dataset, "$.dataset");

  if (!hasProblems(issues)) {
    issues.push(success("dataset-ok", "$.dataset", "Das Datenblatt ist vollständig und kann exportiert werden."));
  }

  return finalizeValidation(issues);
}

export function validateDatasetSeries(root: DatasetSeriesRootJson, activeIssueId?: string): ValidationResult {
  const groups: ValidationGroup[] = [];

  const seriesIssues: ValidationIssue[] = [];
  if (root.schemaVersion !== DEFAULT_SCHEMA_VERSION) {
    seriesIssues.push(
      issue(
        "warning",
        "schema-version",
        "$.schemaVersion",
        `Schema-Version ${root.schemaVersion} weicht vom MVP-Export ${DEFAULT_SCHEMA_VERSION} ab.`
      )
    );
  }

  validateSeriesMetadata(seriesIssues, root.series, "$.series");

  const issues = root.series.issues ?? [];
  if (!issues.length) {
    seriesIssues.push(
      issue(
        "warning",
        "series-issues-empty",
        "$.series.issues",
        "Noch keine Ausgabe erfasst. Fügen Sie mindestens eine Ausgabe hinzu."
      )
    );
  } else {
    const currentIssueCount = issues.filter((entry) => entry.isCurrentIssue).length;
    if (currentIssueCount !== 1) {
      seriesIssues.push(
        issue(
          "error",
          "series-current-issue",
          "$.series.issues",
          "Genau eine Ausgabe muss als aktuelle Ausgabe markiert sein."
        )
      );
    }
  }

  if (!hasProblems(seriesIssues)) {
    seriesIssues.push(success("series-ok", "$.series", "Die gemeinsamen Serienfelder sind vollständig."));
  }

  groups.push(finalizeGroup("series", "Serie", "series", seriesIssues));

  const issueSummaries: IssueValidationSummary[] = [];
  for (const [index, issueEntry] of issues.entries()) {
    const entryIssues: ValidationIssue[] = [];
    const issueId = issueEntry.__localIssueId ?? `issue-${index + 1}`;
    const issueLabel = labelForIssue(issueEntry, index);
    const issuePath = `$.series.issues[${index}]`;
    const effectiveIssue = createEffectiveIssue(root.series, issueEntry);

    validateIssueMetadata(entryIssues, issueEntry, effectiveIssue, issuePath);

    if (!hasProblems(entryIssues)) {
      entryIssues.push(success("issue-ok", issuePath, "Diese Ausgabe hat keine offenen Probleme."));
    }

    const group = finalizeGroup(issueId, issueLabel, "issue", entryIssues, {
      active: issueId === activeIssueId,
      issueId
    });

    issueSummaries.push({
      issueId,
      label: issueEntry.issueLabel?.trim() || `Ausgabe ${index + 1}`,
      title: effectiveIssue.title?.trim() || "Unbenannte Ausgabe",
      isCurrentIssue: issueEntry.isCurrentIssue === true,
      errorCount: group.errorCount,
      warningCount: group.warningCount
    });
    groups.push(group);
  }

  const allIssues = groups.flatMap((group) => group.issues);
  return finalizeValidation(
    allIssues,
    groups,
    issueSummaries,
    issues.length > 0 && allIssues.every((entry) => entry.severity !== "error")
  );
}

function validateDatasetMetadata(issues: ValidationIssue[], dataset: Dataset, prefix: string): void {
  pushRequired(issues, dataset.identifier, `${prefix}.identifier`, "Identifier ist ein Pflichtfeld.");
  pushRequired(issues, dataset.title, `${prefix}.title`, "Titel ist ein Pflichtfeld.");
  pushRequired(issues, dataset.description, `${prefix}.description`, "Beschreibung ist ein Pflichtfeld.");
  pushRequired(issues, dataset.accessLevel, `${prefix}.accessLevel`, "AccessLevel ist ein Pflichtfeld.");
  validateEnumField(issues, dataset.accessLevel, accessLevelValues, `${prefix}.accessLevel`, "AccessLevel");
  pushRequired(
    issues,
    dataset.publicationStatus,
    `${prefix}.publicationStatus`,
    "PublicationStatus ist ein Pflichtfeld."
  );
  validateEnumField(
    issues,
    dataset.publicationStatus,
    publicationStatusValues,
    `${prefix}.publicationStatus`,
    "PublicationStatus"
  );
  pushRequired(issues, dataset.creatorRef, `${prefix}.creatorRef`, "Datenherr ist ein Pflichtfeld.");
  pushRequired(
    issues,
    dataset.contactPoint?.email,
    `${prefix}.contactPoint.email`,
    "Die Kontakt-E-Mail ist ein Pflichtfeld."
  );
  if (!dataset.themes?.length) {
    issues.push(issue("error", "required", `${prefix}.themes`, "Mindestens ein Thema ist ein Pflichtfeld."));
  } else {
    for (const [index, theme] of dataset.themes.entries()) {
      validateEnumField(issues, theme, themeValues, `${prefix}.themes[${index}]`, "Thema");
    }
  }
  pushRequired(issues, dataset.modified, `${prefix}.modified`, "Modified ist ein Pflichtfeld.");
  validateEnumField(
    issues,
    dataset.accrualPeriodicity,
    accrualPeriodicityValues,
    `${prefix}.accrualPeriodicity`,
    "Nachführung"
  );

  validateDatasetCommonFields(issues, dataset, prefix);
  validateUriField(issues, dataset.contactPoint?.email, `${prefix}.contactPoint.email`, "Kontakt-E-Mail");
  validateUriField(issues, dataset.contactPoint?.url, `${prefix}.contactPoint.url`, "Kontakt-URL");
}

function validateSeriesMetadata(issues: ValidationIssue[], datasetSeries: DatasetSeries, prefix: string): void {
  validateDatasetMetadata(issues, datasetSeries, prefix);
}

function validateIssueMetadata(
  issues: ValidationIssue[],
  datasetIssue: DatasetIssue,
  effectiveIssue: DatasetIssue,
  prefix: string
): void {
  pushRequired(issues, effectiveIssue.identifier, `${prefix}.identifier`, "Identifier ist ein Pflichtfeld.");
  pushRequired(
    issues,
    effectiveIssue.publicationStatus,
    `${prefix}.publicationStatus`,
    "PublicationStatus ist ein Pflichtfeld."
  );
  pushRequired(issues, datasetIssue.issueLabel, `${prefix}.issueLabel`, "IssueLabel ist ein Pflichtfeld.");
  validateEnumField(
    issues,
    effectiveIssue.publicationStatus,
    publicationStatusValues,
    `${prefix}.publicationStatus`,
    "PublicationStatus"
  );
  validateEnumField(
    issues,
    effectiveIssue.accrualPeriodicity,
    accrualPeriodicityValues,
    `${prefix}.accrualPeriodicity`,
    "Nachführung"
  );
  validateIssueSharedFields(issues, datasetIssue, effectiveIssue, prefix);
}

function validateDatasetCommonFields(
  issues: ValidationIssue[],
  entry: Pick<Dataset, "description" | "identifier" | "modified" | "attributes" | "temporalCoverage" | "contactPoint"> &
    JsonObject,
  prefix: string
): void {
  validateDescriptionLength(issues, entry.description, `${prefix}.description`);
  if (entry.identifier && entry.identifier !== entry.identifier.trim()) {
    issues.push(
      issue(
        "error",
        "identifier-whitespace",
        `${prefix}.identifier`,
        "Der Identifier darf keine führenden oder nachgestellten Leerzeichen enthalten."
      )
    );
  }

  validateDateField(issues, toStringValue(entry.modified), `${prefix}.modified`, "Modified");
  validateTemporalCoverage(issues, entry.temporalCoverage, `${prefix}.temporalCoverage`);
  validateAttributeIssues(issues, entry.attributes ?? [], `${prefix}.attributes`);
}

function validateIssueSharedFields(
  issues: ValidationIssue[],
  datasetIssue: DatasetIssue,
  effectiveIssue: DatasetIssue,
  prefix: string
): void {
  if (effectiveIssue.identifier && effectiveIssue.identifier !== effectiveIssue.identifier.trim()) {
    issues.push(
      issue(
        "error",
        "identifier-whitespace",
        `${prefix}.identifier`,
        "Der Identifier darf keine führenden oder nachgestellten Leerzeichen enthalten."
      )
    );
  }

  validateDescriptionLength(issues, effectiveIssue.description, `${prefix}.description`);
  if (!isIssueGroupInherited(datasetIssue, "modified")) {
    validateDateField(issues, toStringValue(effectiveIssue.modified), `${prefix}.modified`, "Modified");
  }

  if (!isIssueGroupInherited(datasetIssue, "temporalCoverage")) {
    validateTemporalCoverage(issues, effectiveIssue.temporalCoverage, `${prefix}.temporalCoverage`);
  }

  validateAttributeIssues(issues, effectiveIssue.attributes ?? [], `${prefix}.attributes`);
}

function validateAttributeIssues(issues: ValidationIssue[], attributes: DatasetAttribute[], prefix: string): void {
  const seen = new Set<string>();
  let missingDescriptionCount = 0;

  for (const [index, attribute] of attributes.entries()) {
    const name = (attribute.name ?? "").trim();
    if (!name) {
      issues.push(
        issue("error", "attribute-name", `${prefix}[${index}].name`, "Jedes Attribut benötigt einen Namen.")
      );
      continue;
    }

    if (!attribute.dataType?.trim()) {
      issues.push(
        issue("error", "attribute-data-type", `${prefix}[${index}].dataType`, "Jedes Attribut benötigt einen Datentyp.")
      );
    }

    if (typeof attribute.mandatory !== "boolean") {
      issues.push(
        issue("error", "attribute-mandatory", `${prefix}[${index}].mandatory`, "Jedes Attribut benötigt eine Pflichtangabe.")
      );
    }

    const normalizedName = name.toLocaleLowerCase("de-CH");
    if (seen.has(normalizedName)) {
      issues.push(
        issue(
          "warning",
          "attribute-duplicate",
          `${prefix}[${index}].name`,
          `Attributname "${name}" ist mehrfach vorhanden.`
        )
      );
    }
    seen.add(normalizedName);

    if (!attribute.description?.trim()) {
      missingDescriptionCount += 1;
    }

    validateUriField(issues, attribute.codeList, `${prefix}[${index}].codeList`, "CodeList-URI");
  }

  if (missingDescriptionCount > 0) {
    issues.push(
      issue(
        "warning",
        "attribute-description",
        prefix,
        `${missingDescriptionCount} Attribute haben keine Beschreibung.`
      )
    );
  }
}

function validateTemporalCoverage(issues: ValidationIssue[], coverage: JsonObject | undefined, prefix: string): void {
  if (!coverage || !Object.keys(coverage).length) {
    return;
  }

  const startDate = toStringValue(coverage.startDate);
  const endDate = toStringValue(coverage.endDate);
  const referenceDate = toStringValue(coverage.referenceDate);

  const hasRange = Boolean(startDate || endDate);
  const hasReference = Boolean(referenceDate);

  if (hasRange && hasReference) {
    issues.push(
      issue(
        "error",
        "temporal-xor",
        prefix,
        "TemporalCoverage darf entweder einen Zeitraum oder einen Stichtag enthalten, nicht beides."
      )
    );
  }

  if (hasRange) {
    if (!startDate || !endDate) {
      issues.push(
        issue(
          "error",
          "temporal-range-incomplete",
          prefix,
          "Für einen Zeitraum müssen StartDate und EndDate gemeinsam gesetzt sein."
        )
      );
    }

    validateDateField(issues, startDate, `${prefix}.startDate`, "StartDate");
    validateDateField(issues, endDate, `${prefix}.endDate`, "EndDate");

    if (startDate && endDate && isIsoDate(startDate) && isIsoDate(endDate) && endDate < startDate) {
      issues.push(
        issue(
          "error",
          "temporal-range-order",
          `${prefix}.endDate`,
          "EndDate darf nicht vor StartDate liegen."
        )
      );
    }
  }

  if (hasReference) {
    validateDateField(issues, referenceDate, `${prefix}.referenceDate`, "ReferenceDate");
  }
}

function validateDateField(issues: ValidationIssue[], value: string | undefined, path: string, label: string): void {
  if (!value) {
    return;
  }

  if (!isIsoDate(value)) {
    issues.push(issue("error", "date-format", path, `${label} muss das Format YYYY-MM-DD haben.`));
  }
}

function pushRequired(issues: ValidationIssue[], value: string | undefined, path: string, message: string): void {
  if (!value?.trim()) {
    issues.push(issue("error", "required", path, message));
  }
}

function validateEnumField(
  issues: ValidationIssue[],
  value: string | undefined,
  allowedValues: Set<string>,
  path: string,
  label: string
): void {
  if (value?.trim() && !allowedValues.has(value)) {
    issues.push(issue("error", "invalid-code", path, `${label} enthält einen nicht erlaubten Wert.`));
  }
}

function validateDescriptionLength(issues: ValidationIssue[], description: string | undefined, path: string): void {
  if ((description ?? "").length > 1024) {
    issues.push(issue("error", "description-length", path, "Die Beschreibung darf maximal 1024 Zeichen lang sein."));
  }
}

function validateUriField(issues: ValidationIssue[], value: string | undefined, path: string, label: string): void {
  if (!value?.trim()) {
    return;
  }

  try {
    new URL(value);
  } catch {
    issues.push(issue("error", "uri-format", path, `${label} muss eine gültige URI sein.`));
  }
}

function hasProblems(issues: ValidationIssue[]): boolean {
  return issues.some((entry) => entry.severity === "error" || entry.severity === "warning");
}

function finalizeGroup(
  id: string,
  title: string,
  scope: "series" | "issue",
  issues: ValidationIssue[],
  options: { active?: boolean; issueId?: string } = {}
): ValidationGroup {
  return {
    id,
    title,
    scope,
    active: options.active,
    issueId: options.issueId,
    issues,
    errorCount: issues.filter((entry) => entry.severity === "error").length,
    warningCount: issues.filter((entry) => entry.severity === "warning").length
  };
}

function finalizeValidation(
  issues: ValidationIssue[],
  groups?: ValidationGroup[],
  issueSummaries?: IssueValidationSummary[],
  exportable = issues.every((entry) => entry.severity !== "error")
): ValidationResult {
  return {
    issues,
    errorCount: issues.filter((entry) => entry.severity === "error").length,
    warningCount: issues.filter((entry) => entry.severity === "warning").length,
    exportable,
    groups,
    issueSummaries
  };
}

function issue(severity: ValidationIssue["severity"], code: string, path: string, message: string): ValidationIssue {
  return {
    severity,
    code,
    path,
    message
  };
}

function success(code: string, path: string, message: string): ValidationIssue {
  return issue("success", code, path, message);
}

function isIsoDate(value: string): boolean {
  return isoDatePattern.test(value);
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function labelForIssue(entry: DatasetIssue, index: number): string {
  const issueLabel = entry.issueLabel?.trim();
  if (issueLabel) {
    return issueLabel;
  }

  const title = entry.title?.trim();
  if (title) {
    return title;
  }

  return `Ausgabe ${index + 1}`;
}
