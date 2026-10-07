package ch.so.agi.datasheet;

import ch.so.agi.datasheet.interlis.InterlisService;
import ch.so.agi.datasheet.service.*;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static org.assertj.core.api.Assertions.*;

class DatasheetServiceTest {
    static InterlisService interlis;
    DatasheetService service;
    @BeforeAll static void start() throws Exception { interlis = new InterlisService(); }
    @AfterAll static void stop() { interlis.close(); }
    @BeforeEach void setup() { service = new DatasheetService(interlis, Optional.of(new ch.so.agi.datasheet.service.ExportStore(java.time.Clock.systemUTC(), "http://127.0.0.1:8000"))); }
    static String fixture(String name) throws Exception {
        try (var input = DatasheetServiceTest.class.getResourceAsStream("/" + name + ".xtf")) {
            return new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
    }
    @SuppressWarnings("unchecked") static Map<String, Object> obj(Object o) { return (Map<String, Object>) o; }
    @SuppressWarnings("unchecked") static List<Map<String, Object>> list(Object o) { return (List<Map<String, Object>>) o; }
    static String id(Map<String, Object> draft) { return (String) draft.get("draft_id"); }
    static long rev(Map<String, Object> draft) { return ((Number) draft.get("revision")).longValue(); }
    static Map<String, Object> data(Map<String, Object> draft) { return obj(draft.get("data")); }

    @Test void datasetRoundtripAndAttributePatch() throws Exception {
        var draft = service.importXtf(fixture("dataset"));
        String id = id(draft);
        var changed = service.upsertAttribute(id, 1, null, null,
                Map.of("name", "FOO", "data_type", "Text", "description", "Flächenmass in Quadratmeter", "unit", "m²", "mandatory", false));
        var attribute = list(data(changed).get("attributes")).getLast();
        String attributeId = (String) attribute.get("attribute_id");
        changed = service.upsertAttribute(id, 2, null, null, Map.of("name", "FOO", "description", "Neue Bedeutung"));
        assertThat(list(data(changed).get("attributes")).getLast())
                .containsEntry("attribute_id", attributeId).containsEntry("unit", "m²")
                .containsEntry("mandatory", false).containsEntry("data_type", "Text")
                .containsEntry("description", "Neue Bedeutung");
        assertThat(changed.get("changes")).isNotNull();
        var exported = service.export(id, 3, true);
        String xml = (String) exported.get("xml");
        assertThat(xml).doesNotContain(attributeId, "attribute_id");
        assertThat(interlis.validate(xml).valid()).isTrue();
        var imported = service.importXtf(xml);
        assertThat(imported).containsEntry("object_id", draft.get("object_id")).containsEntry("basket_id", draft.get("basket_id"));
        assertThat(data(imported)).containsEntry("title", data(draft).get("title"));
        assertThat(obj(data(imported).get("temporal_coverage"))).containsEntry("start_date", "2024-01-01");
        Files.createDirectories(Path.of("build/interop"));
        Files.writeString(Path.of("build/interop/dataset.xtf"), xml);
    }

    @Test void seriesRoundtripAndIssueOperations() throws Exception {
        var draft = service.importXtf(fixture("series"));
        String id = id(draft);
        var created = service.upsertIssue(id, 1, null, Map.of("identifier", "new", "issue_label", "2026",
                "is_current_issue", false, "publication_status", "draft"));
        var issue = list(data(created).get("issues")).getLast();
        String issueId = (String) issue.get("issue_id");
        var changed = service.upsertAttribute(id, 2, issueId, null,
                Map.of("name", "FOO", "data_type", "Text", "mandatory", true));
        service.update(id, 3, issueId, Map.of("description", "Ausgabebeschreibung"));
        var exported = service.export(id, 4, true);
        String xml = (String) exported.get("xml");
        var imported = service.importXtf(xml);
        var last = list(data(imported).get("issues")).getLast();
        assertThat(last).containsEntry("description", "Ausgabebeschreibung").doesNotContainKey("title");
        assertThat(list(last.get("attributes")).getFirst()).containsEntry("name", "FOO");
        assertThat(list(data(changed).get("attributes"))).noneMatch(a -> "FOO".equals(a.get("name")));
        service.removeIssue(id, 4, issueId);
        var current = service.read(id);
        for (var entry : list(data(current).get("issues"))) {
            current = service.removeIssue(id, rev(current), (String) entry.get("issue_id"));
        }
        assertThat(service.validate(id, rev(current))).containsEntry("valid", false);
        Files.createDirectories(Path.of("build/interop"));
        Files.writeString(Path.of("build/interop/series.xtf"), xml);
    }

    @Test void incompleteDraftsAndModelViolations() throws Exception {
        var empty = service.create("series", Map.of());
        assertThat(service.validate(id(empty), 1)).containsEntry("valid", false);
        assertThatThrownBy(() -> service.export(id(empty), 1, true)).isInstanceOf(ToolError.class);
        for (var patch : List.of(Map.<String, Object>of("access_level", "wrong"),
                Map.<String, Object>of("title", "x".repeat(256)),
                Map.<String, Object>of("temporal_coverage", Map.of("start_date", "2026-01-01")),
                Map.<String, Object>of("themes", List.of()),
                Map.<String, Object>of("modified", "not-a-date"))) {
            var draft = service.importXtf(fixture("dataset"));
            service.update(id(draft), 1, null, patch);
            assertThat(service.validate(id(draft), 2)).containsEntry("valid", false);
        }
        var draft = service.importXtf(fixture("dataset"));
        service.upsertAttribute(id(draft), 1, null, null, Map.of("name", "FOO", "data_type", "Text"));
        assertThat(service.validate(id(draft), 2)).containsEntry("valid", false);
    }

    @Test void nullContactMergeTemporalReplacementAndAtomicFailure() throws Exception {
        var draft = service.importXtf(fixture("dataset"));
        String id = id(draft);
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("contact_point", Map.of("name", "Neu"));
        patch.put("survey_method", null);
        patch.put("temporal_coverage", Map.of("reference_date", "2026-01-01"));
        var result = service.update(id, 1, null, patch);
        assertThat(obj(data(result).get("contact_point"))).containsEntry("email", "mailto:afu@bd.so.ch");
        assertThat(data(result)).doesNotContainKey("survey_method");
        assertThat(obj(data(result).get("temporal_coverage"))).containsOnlyKeys("reference_date");
        Map<String, Object> bad = new LinkedHashMap<>();
        bad.put("title", "Should not persist"); bad.put("unknown", true);
        assertThatThrownBy(() -> service.update(id, 2, null, bad)).isInstanceOf(ToolError.class);
        assertThat(service.read(id)).isEqualTo(resultWithoutChanges(result));
        assertThatThrownBy(() -> service.update(id, 2, null, Map.of("contact_point", Map.of("email", 7))))
                .isInstanceOf(ToolError.class);
    }
    static Map<String, Object> resultWithoutChanges(Map<String, Object> result) {
        var copy = new LinkedHashMap<>(result); copy.remove("changes"); return copy;
    }

    @Test void ambiguousAttributesRequireIdAndDuplicateIssueIdentifiersAreInvalid() throws Exception {
        var draft = service.importXtf(fixture("dataset"));
        String id = id(draft);
        service.upsertAttribute(id, 1, null, null, Map.of("name", "FOO", "data_type", "Text", "mandatory", false));
        var created = service.upsertAttribute(id, 2, null, null, Map.of("name", "BAR", "data_type", "Text", "mandatory", false));
        String bar = (String) list(data(created).get("attributes")).getLast().get("attribute_id");
        service.upsertAttribute(id, 3, null, bar, Map.of("name", "FOO"));
        assertThatThrownBy(() -> service.upsertAttribute(id, 4, null, null, Map.of("name", "FOO", "unit", "m²")))
                .isInstanceOfSatisfying(ToolError.class, e -> assertThat(e.code).isEqualTo("ambiguous_match"));
        service.removeAttribute(id, 4, null, bar);

        var series = service.importXtf(fixture("series"));
        String existing = (String) list(data(series).get("issues")).getFirst().get("identifier");
        var added = service.upsertIssue(id(series), 1, null,
                Map.of("identifier", "another", "issue_label", "Other", "is_current_issue", false, "publication_status", "draft"));
        String issueId = (String) list(data(added).get("issues")).getLast().get("issue_id");
        service.upsertIssue(id(series), 2, issueId, Map.of("identifier", existing));
        assertThat(service.validate(id(series), 3)).containsEntry("valid", false);
    }

    @Test void sameRevisionHasExactlyOneWinnerAndSnapshotsAreDetached() throws Exception {
        var draft = service.importXtf(fixture("dataset"));
        String id = id(draft);
        try (var pool = Executors.newFixedThreadPool(8)) {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<String>> calls = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                final int n = i;
                calls.add(pool.submit(() -> {
                    start.await();
                    try { service.update(id, 1, null, Map.of("title", "Title " + n)); return "ok"; }
                    catch (ToolError e) { return e.code; }
                }));
            }
            start.countDown();
            List<String> outcomes = new ArrayList<>();
            for (var call : calls) outcomes.add(call.get(30, TimeUnit.SECONDS));
            assertThat(outcomes).filteredOn("ok"::equals).hasSize(1);
            assertThat(outcomes).filteredOn("revision_conflict"::equals).hasSize(7);
        }
        data(draft).put("title", "Outside mutation");
        assertThat(data(service.read(id)).get("title")).isNotEqualTo("Outside mutation");
        service.discard(id, 2);
        assertThatThrownBy(() -> service.read(id)).isInstanceOf(ToolError.class);
    }

    @Test void parallelValidationAndExportAreIsolated() throws Exception {
        var valid = service.importXtf(fixture("dataset"));
        var invalid = service.importXtf(fixture("dataset"));
        service.update(id(invalid), 1, null, Map.of("title", "x".repeat(256)));
        try (var pool = Executors.newFixedThreadPool(4)) {
            var good = pool.submit(() -> service.validate(id(valid), 1));
            var bad = pool.submit(() -> service.validate(id(invalid), 2));
            var export = pool.submit(() -> service.export(id(valid), 1, true));
            assertThat(good.get(30, TimeUnit.SECONDS)).containsEntry("valid", true).containsEntry("messages", List.of());
            assertThat(bad.get(30, TimeUnit.SECONDS)).containsEntry("valid", false);
            assertThat(export.get(30, TimeUnit.SECONDS)).containsEntry("revision", 1L);
        }
    }

    @Test void groupedStructuresAndAllFieldValuesSurviveRoundtrip() throws Exception {
        var draft = service.importXtf(fixture("dataset"));
        String id = id(draft);
        var changed = service.update(id, 1, null, Map.of(
                "issued", "2020-01-01", "model", "ExampleModel", "themes", List.of("Geografie", "Energie"),
                "contact_point", Map.of("url", "https://example.org", "phone", "+41 32 000 00 00")));
        changed = service.upsertAttribute(id, 2, null, null, Map.of(
                "name", "FOO", "data_type", "Text", "mandatory", false, "unit", "m²",
                "code_list", "https://example.org/codes", "description", "A & B < C"));
        String xml = (String) service.export(id, 3, true).get("xml");
        var imported = service.importXtf(xml);
        assertThat(withoutLocalIds(data(imported))).isEqualTo(withoutLocalIds(data(changed)));
        // IOX's grouped structure representation is accepted as well as the editor's repeated wrappers.
        String wrapper = "SO_AGI_DataCatalog_Datasheet_20260523:attributes";
        String grouped = xml.replace("</" + wrapper + "><" + wrapper + ">", "");
        assertThat(grouped).isNotEqualTo(xml);
        assertThat(withoutLocalIds(data(service.importXtf(grouped)))).isEqualTo(withoutLocalIds(data(changed)));
    }

    private static Object withoutLocalIds(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((key, item) -> {
                if (!Set.of("attribute_id", "issue_id").contains(key.toString()))
                    result.put(key.toString(), withoutLocalIds(item));
            });
            return result;
        }
        if (value instanceof List<?> list) return list.stream().map(DatasheetServiceTest::withoutLocalIds).toList();
        return value;
    }

    @Test void concurrentExportUsesOneCoherentRevision() throws Exception {
        var draft = service.importXtf(fixture("dataset"));
        String id = id(draft);
        try (var pool = Executors.newFixedThreadPool(2)) {
            CountDownLatch start = new CountDownLatch(1);
            var exported = pool.submit(() -> {
                start.await();
                try { return service.export(id, 1, true); }
                catch (ToolError e) {
                    assertThat(e.code).isEqualTo("revision_conflict");
                    return null;
                }
            });
            var changed = pool.submit(() -> {
                start.await();
                return service.update(id, 1, null, Map.of("title", "New title", "description", "New description"));
            });
            start.countDown();
            changed.get(30, TimeUnit.SECONDS);
            var result = exported.get(30, TimeUnit.SECONDS);
            if (result != null) {
                assertThat(result).containsEntry("revision", 1L);
                var imported = service.importXtf((String) result.get("xml"));
                assertThat(data(imported)).containsEntry("title", data(draft).get("title"))
                        .containsEntry("description", data(draft).get("description"));
            }
            assertThat(service.export(id, 2, true)).containsEntry("revision", 2L);
        }
    }

    @Test void rejectUnknownXmlAndUnsupportedTransfers() throws Exception {
        String xml = fixture("dataset");
        for (String bad : List.of(
                xml.replace("SO_AGI_DataCatalog_Datasheet_20260523", "OtherModel"),
                xml.replace("</ns1:title>", "</ns1:title><ns1:unknown>lost</ns1:unknown>"),
                "<!DOCTYPE foo [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><foo>&x;</foo>")) {
            assertThat(bad).isNotEqualTo(xml);
            assertThatThrownBy(() -> service.importXtf(bad)).isInstanceOf(ToolError.class);
        }
        assertThatThrownBy(() -> service.importXtf("<broken>")).isInstanceOf(ToolError.class);
    }
}
