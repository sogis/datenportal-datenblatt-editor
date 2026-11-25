import { describe, expect, it } from "vitest";
import {
  createEmptyDatasetIssue,
  createEmptyDatasetRoot,
  createEmptyDatasetSeriesRoot,
  isDatasetSeriesRoot
} from "../domain/normalize";
import { parseOfficeCatalogTransfer, parseXtfTransfer, serializeToXtf } from "./xtfService";

const exampleTransfer = `<?xml version="1.0" encoding="UTF-8"?>
<ili:transfer xmlns="http://www.interlis.ch/xtf/2.4/SO_AGI_DataCatalog_Datasheet_20260523" xmlns:base="http://www.interlis.ch/xtf/2.4/SO_AGI_DataCatalog_Base_20260529" xmlns:ili="http://www.interlis.ch/xtf/2.4/INTERLIS">
  <ili:headersection>
    <ili:models>
      <ili:model>SO_AGI_DataCatalog_Datasheet_20260523</ili:model>
      <ili:model>SO_AGI_DataCatalog_Base_20260529</ili:model>
    </ili:models>
  </ili:headersection>
  <ili:datasection>
    <Metadata ili:bid="x1">
      <Dataset ili:tid="ch.so.grundwasser.qualitaet">
        <identifier>ch.so.grundwasser.qualitaet</identifier>
        <title>Wasserqualität Grundwasser Kanton Solothurn</title>
        <description>Messdaten der Grundwasserqualitätsuntersuchungen im Kanton Solothurn.</description>
        <accessLevel>open</accessLevel>
        <publicationStatus>published</publicationStatus>
        <creatorRef>ch.so.afu</creatorRef>
        <model>SO_AGI_Groundwater_Model</model>
        <contactPoint>
          <base:ContactPoint>
            <base:email>mailto:afu@bd.so.ch</base:email>
          </base:ContactPoint>
        </contactPoint>
        <themes>Raum_und_Umwelt</themes>
        <modified>2025-05-19</modified>
      </Dataset>
      <DatasetSeries ili:tid="ch.so.bevoelkerung.altersstruktur">
        <identifier>ch.so.bevoelkerung.altersstruktur</identifier>
        <title>Altersstruktur der Wohnbevölkerung</title>
        <description>Altersstruktur im Kanton Solothurn.</description>
        <accessLevel>open</accessLevel>
        <publicationStatus>published</publicationStatus>
        <creatorRef>ch.so.afin</creatorRef>
        <model>SO_AGI_Series_Model</model>
        <contactPoint>
          <base:ContactPoint>
            <base:email>mailto:statistik@fd.so.ch</base:email>
          </base:ContactPoint>
        </contactPoint>
        <themes>Bevoelkerung</themes>
        <modified>2025-12-31</modified>
        <issues>
          <DatasetIssue>
            <identifier>ch.so.bevoelkerung.altersstruktur_2025</identifier>
            <issueLabel>2025</issueLabel>
            <isCurrentIssue>true</isCurrentIssue>
            <publicationStatus>published</publicationStatus>
          </DatasetIssue>
        </issues>
        <issues>
          <DatasetIssue>
            <identifier>ch.so.bevoelkerung.altersstruktur_2024</identifier>
            <issueLabel>2024</issueLabel>
            <isCurrentIssue>false</isCurrentIssue>
            <publicationStatus>published</publicationStatus>
            <model>SO_AGI_Issue_Model</model>
          </DatasetIssue>
        </issues>
      </DatasetSeries>
    </Metadata>
  </ili:datasection>
</ili:transfer>`;

const officeTransfer = `<?xml version="1.0" encoding="UTF-8"?>
<ili:transfer xmlns:ili="http://www.interlis.ch/xtf/2.4/INTERLIS" xmlns:base="http://www.interlis.ch/xtf/2.4/SO_AGI_DataCatalog_Base_20260529">
  <ili:headersection>
    <ili:models>
      <ili:model>SO_AGI_DataCatalog_Base_20260529</ili:model>
    </ili:models>
  </ili:headersection>
  <ili:datasection>
    <base:Office ili:bid="SO_AGI_DataCatalog_Base_20260529.Office">
      <base:Office.Office ili:tid="ch.so.afu">
        <base:identifier>ch.so.afu</base:identifier>
        <base:name>Amt für Umwelt</base:name>
      </base:Office.Office>
      <base:Office.Office ili:tid="ch.so.agi">
        <base:identifier>ch.so.agi</base:identifier>
        <base:name>Amt für Geoinformation</base:name>
      </base:Office.Office>
    </base:Office>
  </ili:datasection>
</ili:transfer>`;

describe("xtfService", () => {
  it("parses dataset and dataset series transfers", () => {
    const roots = parseXtfTransfer(exampleTransfer);

    expect(roots).toHaveLength(2);
    expect(roots[0]?.type).toBe("Dataset");
    if (roots[0]?.type !== "Dataset") {
      throw new Error("Expected dataset root");
    }
    expect(roots[0].dataset.model).toBe("SO_AGI_Groundwater_Model");
    expect(roots[0].dataset.creatorRef).toBe("ch.so.afu");
    expect(isDatasetSeriesRoot(roots[1])).toBe(true);
    if (!isDatasetSeriesRoot(roots[1])) {
      throw new Error("Expected dataset series root");
    }
    expect(roots[1].series.model).toBe("SO_AGI_Series_Model");
    expect(roots[1].series.creatorRef).toBe("ch.so.afin");
    expect(roots[1].series.issues).toHaveLength(2);
    expect(roots[1].series.issues?.[0]?.model).toBe("SO_AGI_Series_Model");
    expect(roots[1].series.issues?.[0]?.__localIssueState?.inheritedGroups?.model).toBe(true);
    expect(roots[1].series.issues?.[1]?.model).toBe("SO_AGI_Issue_Model");
    expect(roots[1].series.issues?.[1]?.__localIssueState?.inheritedGroups?.model).toBe(false);
  });

  it("parses office catalog transfers", () => {
    expect(parseOfficeCatalogTransfer(officeTransfer)).toEqual([
      { identifier: "ch.so.afu", name: "Amt für Umwelt" },
      { identifier: "ch.so.agi", name: "Amt für Geoinformation" }
    ]);
  });

  it("sets fixed metadata when imported XTF has missing or different values", () => {
    const legacyTransfer = exampleTransfer
      .replace("<accessLevel>open</accessLevel>", "<accessLevel>restricted</accessLevel>")
      .replaceAll("<publicationStatus>published</publicationStatus>", "<publicationStatus>archived</publicationStatus>")
      .replace("<publicationStatus>archived</publicationStatus>", "");

    const [dataset, series] = parseXtfTransfer(legacyTransfer);
    expect(dataset).toMatchObject({ dataset: { accessLevel: "open", publicationStatus: "published" } });
    expect(series).toMatchObject({
      series: {
        accessLevel: "open",
        publicationStatus: "published",
        issues: [{ publicationStatus: "published" }, { publicationStatus: "published" }]
      }
    });
  });

  it("serializes a dataset to xtf", () => {
    const root = createEmptyDatasetRoot();
    root.dataset.identifier = "so.afu.test";
    root.dataset.title = "Test";
    root.dataset.description = "Beschreibung";
    root.dataset.accessLevel = "open";
    root.dataset.publicationStatus = "published";
    root.dataset.creatorRef = "ch.so.afu";
    root.dataset.contactPoint!.email = "mailto:afu@bd.so.ch";
    root.dataset.themes = ["Raum_und_Umwelt"];
    root.dataset.modified = "2026-05-12";
    root.dataset.model = "SO_AGI_Dataset_Model";

    const xml = serializeToXtf(root);

    expect(xml).toContain("<Dataset");
    expect(xml).toContain('ili:tid="so.afu.test"');
    expect(xml).toContain("<creatorRef>ch.so.afu</creatorRef>");
    expect(xml).toContain("<model>SO_AGI_Dataset_Model</model>");
  });

  it("serializes a dataset series without local issue metadata", () => {
    const root = createEmptyDatasetSeriesRoot();
    root.series.identifier = "so.astat.reihe";
    root.series.title = "Reihe";
    root.series.description = "Beschreibung";
    root.series.accessLevel = "open";
    root.series.publicationStatus = "published";
    root.series.creatorRef = "ch.so.astat";
    root.series.contactPoint!.email = "mailto:astat@bd.so.ch";
    root.series.themes = ["Bevoelkerung"];
    root.series.modified = "2026-05-12";
    root.series.model = "SO_AGI_Series_Model";

    const issue = createEmptyDatasetIssue(root.series, { isCurrentIssue: true });
    root.series.issues!.push(issue);
    issue.identifier = "so.astat.reihe_2026";
    issue.issueLabel = "2026";
    issue.isCurrentIssue = true;
    issue.publicationStatus = "published";
    issue.model = "SO_AGI_Issue_Model";
    issue.__localIssueId = "local-1";

    const xml = serializeToXtf(root);

    expect(xml).toContain("<DatasetSeries");
    expect(xml).toContain("<creatorRef>ch.so.astat</creatorRef>");
    expect(xml).toContain("<model>SO_AGI_Series_Model</model>");
    expect(xml).toContain("<model>SO_AGI_Issue_Model</model>");
    expect(xml).not.toContain("__localIssueId");
  });

  it("serializes the current dataset model fields in XSD order", () => {
    const root = createEmptyDatasetRoot();
    root.dataset.identifier = "so.afu.vollstaendig";
    root.dataset.title = "Vollständiger Datensatz";
    root.dataset.description = "Beschreibung";
    root.dataset.accessLevel = "restricted";
    root.dataset.publicationStatus = "in_review";
    root.dataset.creatorRef = "ch.so.afu";
    root.dataset.contactPoint = {
      name: "Kontakt",
      organizationUnit: "AfU",
      email: "mailto:afu@bd.so.ch",
      phone: "+41 32 627 24 61",
      url: "https://afu.so.ch"
    };
    root.dataset.themes = ["Raum_und_Umwelt"];
    root.dataset.keywords = ["Wasser"];
    root.dataset.accrualPeriodicity = "annually";
    root.dataset.modified = "2026-05-12";
    root.dataset.temporalCoverage = { startDate: "2025-01-01", endDate: "2025-12-31" };
    root.dataset.surveyMethod = "Messung";
    root.dataset.attributes = [
      { name: "Jahr", dataType: "INTEGER", description: "Messjahr", mandatory: true }
    ];
    root.dataset.model = "SO_AGI_Water_Model";
    root.dataset.dataAvailableFrom = "ab 2025";
    root.dataset.furtherUses = "Monitoring";
    root.dataset.auxiliaryData = "Messstellenverzeichnis";

    const xml = serializeToXtf(root);
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const dataset = document.getElementsByTagNameNS(
      "http://www.interlis.ch/xtf/2.4/SO_AGI_DataCatalog_Datasheet_20260523",
      "Dataset"
    )[0];

    expect(Array.from(dataset.children).map((element) => element.localName)).toEqual([
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
    ]);
    expect(xml).toContain("<ClosedTemporalCoverage>");
    expect(xml).not.toContain("remarks");
    expect(dataset.getElementsByTagName("accessLevel")[0]?.textContent).toBe("open");
    expect(dataset.getElementsByTagName("publicationStatus")[0]?.textContent).toBe("published");
    expect(root.dataset).toMatchObject({ accessLevel: "restricted", publicationStatus: "in_review" });

    const parsed = serializeToXtf(
      parseXtfTransfer(xml)[0] ?? createEmptyDatasetRoot()
    );
    expect(parsed).toContain("<auxiliaryData>Messstellenverzeichnis</auxiliaryData>");
  });

  it("serializes dataset series and issues according to the current model", () => {
    const root = createEmptyDatasetSeriesRoot();
    root.series.identifier = "so.astat.reihe";
    root.series.title = "Reihe";
    root.series.description = "Beschreibung";
    root.series.accessLevel = "internal";
    root.series.publicationStatus = "draft";
    root.series.creatorRef = "ch.so.astat";
    root.series.contactPoint!.email = "mailto:statistik@fd.so.ch";
    root.series.themes = ["Bevoelkerung"];
    root.series.modified = "2026-05-12";
    root.series.auxiliaryData = "Registerdaten";

    const issue = createEmptyDatasetIssue(root.series, { isCurrentIssue: true });
    root.series.issues!.push(issue);
    issue.identifier = "so.astat.reihe_2026";
    issue.title = "Reihe 2026";
    issue.description = "Ausgabe 2026";
    issue.issueLabel = "2026";
    issue.isCurrentIssue = true;
    issue.publicationStatus = "archived";
    issue.accrualPeriodicity = "annually";
    issue.modified = "2026-12-31";
    issue.temporalCoverage = { referenceDate: "2026-12-31" };
    issue.surveyMethod = "Registerauswertung";
    issue.attributes = [{ name: "Wert", dataType: "INTEGER", mandatory: false }];
    issue.model = "SO_AGI_Issue_Model";
    issue.dataAvailableFrom = "2026";
    issue.furtherUses = "Statistik";
    issue.auxiliaryData = "Ausgabenspezifische Zusatzdaten";

    const xml = serializeToXtf(root);
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const issueElement = document.getElementsByTagNameNS(
      "http://www.interlis.ch/xtf/2.4/SO_AGI_DataCatalog_Datasheet_20260523",
      "DatasetIssue"
    )[0];

    expect(Array.from(issueElement.children).map((element) => element.localName)).toEqual([
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
      "auxiliaryData"
    ]);
    expect(xml).toContain("<auxiliaryData>Registerdaten</auxiliaryData>");
    expect(xml).toContain("<auxiliaryData>Ausgabenspezifische Zusatzdaten</auxiliaryData>");
    expect(Array.from(document.getElementsByTagName("accessLevel"), (element) => element.textContent)).toEqual(["open"]);
    expect(Array.from(document.getElementsByTagName("publicationStatus"), (element) => element.textContent)).toEqual([
      "published",
      "published"
    ]);
  });

  it("rejects fields that are not part of the current model", () => {
    expect(() => parseXtfTransfer(exampleTransfer.replace("<issueLabel>2025</issueLabel>", "<issueLabel>2025</issueLabel><accessLevel>open</accessLevel>"))).toThrow(
      "nicht modellierte Feld \"accessLevel\""
    );
    expect(() => parseXtfTransfer(exampleTransfer.replace("<title>Wasserqualität Grundwasser Kanton Solothurn</title>", "<title>Wasserqualität Grundwasser Kanton Solothurn</title><remarks>veraltet</remarks>"))).toThrow(
      "nicht modellierte Feld \"remarks\""
    );
    expect(() =>
      parseXtfTransfer(
        exampleTransfer.replace(
          "<modified>2025-05-19</modified>",
          "<modified>2025-05-19</modified><temporalCoverage><base:TemporalCoverage><base:referenceDate>2025-05-19</base:referenceDate></base:TemporalCoverage></temporalCoverage>"
        )
      )
    ).toThrow('nicht modellierte Feld "TemporalCoverage"');
    expect(() =>
      parseXtfTransfer(
        exampleTransfer.replace(
          "</ili:models>",
          "<ili:model>SO_AGI_DataCatalog_Datasheet_20240101</ili:model></ili:models>"
        )
      )
    ).toThrow("nicht die aktuellen Datenkatalog-Modelle");
  });
});
