export const themeOptions = [
  { value: "Arbeit_Erwerb", label: "Arbeit und Erwerb" },
  { value: "Bau_und_Wohnungswesen", label: "Bau- und Wohnungswesen" },
  { value: "Bevoelkerung", label: "Bevölkerung" },
  { value: "Bildung_Wissenschaft", label: "Bildung und Wissenschaft" },
  { value: "Energie", label: "Energie" },
  { value: "Finanzen", label: "Finanzen" },
  { value: "Geografie", label: "Geografie" },
  { value: "Gesetzgebung", label: "Gesetzgebung" },
  { value: "Gesundheit", label: "Gesundheit" },
  { value: "Handel", label: "Handel" },
  { value: "Industrie_und_Dienstleistungen", label: "Industrie und Dienstleistungen" },
  { value: "Kriminalitaet_Strafrecht", label: "Kriminalität und Strafrecht" },
  {
    value: "Kultur_Medien_Informationsgesellschaft_Sport",
    label: "Kultur, Medien, Informationsgesellschaft und Sport"
  },
  { value: "Landwirtschaft_Forstwirtschaft", label: "Landwirtschaft und Forstwirtschaft" },
  { value: "Mobilitaet_und_Verkehr", label: "Mobilität und Verkehr" },
  { value: "Oeffentliche_Ordnung_und_Sicherheit", label: "Öffentliche Ordnung und Sicherheit" },
  { value: "Politik", label: "Politik" },
  { value: "Preise", label: "Preise" },
  { value: "Raum_und_Umwelt", label: "Raum und Umwelt" },
  { value: "Soziale_Sicherheit", label: "Soziale Sicherheit" },
  { value: "Statistische_Grundlagen", label: "Statistische Grundlagen" },
  { value: "Tourismus", label: "Tourismus" },
  { value: "Verwaltung", label: "Verwaltung" },
  { value: "Volkswirtschaft", label: "Volkswirtschaft" }
];

export const accrualPeriodicityOptions = [
  { value: "", label: "Bitte wählen" },
  { value: "continual", label: "Kontinuierlich" },
  { value: "daily", label: "Täglich" },
  { value: "weekly", label: "Wöchentlich" },
  { value: "biweekly", label: "Zweiwöchentlich" },
  { value: "monthly", label: "Monatlich" },
  { value: "quarterly", label: "Quartalsweise" },
  { value: "biannually", label: "Halbjährlich" },
  { value: "annually", label: "Jährlich" },
  { value: "asNeeded", label: "Bei Bedarf" },
  { value: "irregular", label: "Unregelmässig" },
  { value: "notPlanned", label: "Nicht geplant" },
  { value: "unknown", label: "Unbekannt" }
];

export const fixedAccessLevel = { value: "open", label: "Öffentlich, frei zugänglich" } as const;
export const fixedPublicationStatus = { value: "published", label: "Veröffentlicht" } as const;

export const accessLevelOptions = [
  { value: "", label: "Bitte wählen" },
  fixedAccessLevel,
  { value: "public_with_conditions", label: "Öffentlich, aber mit Bedingungen" },
  { value: "restricted", label: "Eingeschränkt" },
  { value: "internal", label: "Intern / governanceabhängig" },
  { value: "confidental", label: "Nicht öffentlich" }
];

export const publicationStatusOptions = [
  { value: "", label: "Bitte wählen" },
  { value: "draft", label: "Entwurf" },
  { value: "in_review", label: "In Prüfung" },
  fixedPublicationStatus,
  { value: "archived", label: "Archiviert" }
];

export const attributeDataTypeOptions = [
  "TEXT",
  "INTEGER",
  "NUMERIC",
  "DECIMAL",
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "URI"
];
